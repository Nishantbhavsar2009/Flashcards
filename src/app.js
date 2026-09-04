/**
 * Main Application Controller for SAT Vocabulary Study App.
 * Manages SPA routing, batch flows, MCQ testing, daily streak calculations,
 * and handles global keyboard shortcuts.
 */

import '../style.css';
import { initDb, getAllVocab, saveVocabList, getAllProgress, getProgressForWord, saveProgress, resetProgress, resetAll } from './db.js';
import { parseVocab, parseNataVocab } from './parser.js';
import { generateSessionQueue, updateProgress } from './scheduler.js';
import { generateQuiz } from './quiz.js';
import { exportProgress, importProgress, saveSessionState, loadSessionState, clearSessionState } from './storage.js';
import { showToast, renderSensesList, updateDashboardStats, renderIndicators, renderStatsScreen } from './ui.js';
import synonymsData from './synonyms.json';

// Raw vocabulary files import via Vite ?raw suffix
import rawVocabText from '../sat.vocab.pdf_extracted.md?raw';
import rawNataVocabText from '../nata.vocab.md?raw';

// Application State
const state = {
    activeDeck: localStorage.getItem('Active_Deck') || 'nata', // 'nata' | 'sat'
    currentScreen: 'dashboard',
    fullVocabList: [],
    progressList: [],
    
    // Active Learn Batch State
    currentBatch: [],
    currentWordIndex: 0,
    learnAnswers: [], // Array of rating inputs matching batch: 'correct' | 'learning' | 'weak' | 'wrong' | null
    isCardFlipped: false,

    // Quiz State
    quizQuestions: [],
    currentQuizIndex: 0,
    selectedQuizOption: null, // Index of selected MCQ choice
    quizState: 'question', // 'question' | 'feedback' | 'complete'
    quizCorrectCount: 0,

    // Review State
    reviewType: null, // 'due' | 'weak' | 'missed'
    reviewQueue: [],
    currentReviewIndex: 0,
    isReviewFlipped: false,
    reviewAnswers: [], // Array of rating inputs: 'correct' | 'wrong' | null
    reviewState: 'setup', // 'setup' | 'active' | 'complete'
    
    // Streak statistics
    streak: 0,
    lastStudyDateStr: '' // 'YYYY-MM-DD'
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDb();
        await loadDatabase();
        updateDeckUI();
        restoreSession();
        setupEventListeners();
        setupKeyboardShortcuts();
        updateUI();
        showToast(`Loaded ${state.activeDeck === 'nata' ? 'NATA & Architecture' : 'SAT Vocab'} Master Deck!`, 'success');
    } catch (err) {
        console.error('Initialization error:', err);
        showToast('Database error. Check console logs.', 'danger');
    }
});

// Load vocab and progress lists from database
async function loadDatabase() {
    // 1. Check and populate NATA words in IndexedDB if missing or incomplete
    let nataVocab = await getAllVocab('nata');
    if (nataVocab.length < 493) {
        console.log('Populating NATA vocabulary database...');
        const parsedNata = parseNataVocab(rawNataVocabText);
        await saveVocabList(parsedNata, 'nata');
        nataVocab = parsedNata;
    }

    // 2. Check and populate SAT words in IndexedDB if missing or incomplete
    let satVocab = await getAllVocab('sat');
    if (satVocab.length < 900) {
        console.log('Populating SAT vocabulary database...');
        const parsedSat = parseVocab(rawVocabText);
        await saveVocabList(parsedSat, 'sat');
        satVocab = parsedSat;
    } else {
        // Auto-fix migration check: if aberration has the old incorrect definition, clear and reload!
        const aberrationVocab = satVocab.find(w => w.id === 'aberration');
        if (aberrationVocab && aberrationVocab.senses.some(s => s.meaning.includes('World Series'))) {
            console.log('Migrating vocabulary store to fix parsing bug...');
            const parsedSat = parseVocab(rawVocabText);
            await saveVocabList(parsedSat, 'sat');
            satVocab = parsedSat;
        }
    }

    // 3. Select active deck vocabulary
    const activeDeck = state.activeDeck || 'nata';
    let vocab = activeDeck === 'nata' ? nataVocab : satVocab;

    // Inject synonyms into SAT words if active deck is SAT
    if (activeDeck === 'sat') {
        vocab.forEach(word => {
            if (synonymsData[word.id]) {
                word.senses.forEach((sense, sIdx) => {
                    sense.synonyms = synonymsData[word.id][sIdx] || [];
                });
            } else {
                word.senses.forEach(sense => {
                    sense.synonyms = [];
                });
            }
        });
    }

    state.fullVocabList = vocab;
    state.progressList = await getAllProgress(activeDeck);
    
    // Recalculate streak
    calculateStreak();
}

// Get local calendar date formatted as YYYY-MM-DD
function getLocalDateStr() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Calculate daily study streak
function calculateStreak() {
    // Load streak state from localStorage
    const savedStreak = parseInt(localStorage.getItem('SATVocab_Streak') || '0', 10);
    const savedLastDate = localStorage.getItem('SATVocab_LastDate') || '';
    
    const todayStr = getLocalDateStr();
    
    if (savedLastDate) {
        if (savedLastDate === todayStr) {
            // Already studied today, keep streak
            state.streak = savedStreak;
            state.lastStudyDateStr = savedLastDate;
        } else {
            const lastDate = new Date(savedLastDate + 'T00:00:00');
            const today = new Date(todayStr + 'T00:00:00');
            const diffTime = Math.abs(today - lastDate);
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays === 1) {
                // Studied yesterday, streak is alive but not incremented yet today
                state.streak = savedStreak;
                state.lastStudyDateStr = savedLastDate;
            } else {
                // Streak broken
                state.streak = 0;
                state.lastStudyDateStr = '';
                localStorage.setItem('SATVocab_Streak', '0');
                localStorage.setItem('SATVocab_LastDate', '');
            }
        }
    } else {
        state.streak = 0;
        state.lastStudyDateStr = '';
    }
}

// Increment daily study streak (called when user finishes a batch or quiz)
function markStudyActivity() {
    const todayStr = getLocalDateStr();
    if (state.lastStudyDateStr === todayStr) return; // Already updated today

    if (!state.lastStudyDateStr) {
        // First study activity ever
        state.streak = 1;
    } else {
        const lastDate = new Date(state.lastStudyDateStr + 'T00:00:00');
        const today = new Date(todayStr + 'T00:00:00');
        const diffTime = Math.abs(today - lastDate);
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            state.streak += 1;
        } else {
            state.streak = 1;
        }
    }
    
    state.lastStudyDateStr = todayStr;
    localStorage.setItem('SATVocab_Streak', state.streak.toString());
    localStorage.setItem('SATVocab_LastDate', todayStr);
    
    // Sync UI on both sidebar and mobile header
    const sidebarStreak = document.getElementById('sidebar-streak');
    if (sidebarStreak) sidebarStreak.innerText = state.streak;
    const mobileStreak = document.getElementById('mobile-streak');
    if (mobileStreak) mobileStreak.innerText = state.streak;
}

// Synchronize active deck visual state across UI (headers, badges, titles, toggles)
function updateDeckUI() {
    const isNata = state.activeDeck === 'nata';
    const deckName = isNata ? 'NATA Vocab' : 'SAT Vocab';
    const deckIcon = isNata ? '🏛️' : '🎓';
    const totalWords = state.fullVocabList.length;

    // Document title
    document.title = isNata 
        ? 'NATA & Architecture Vocab - Spaced Repetition Flashcards'
        : 'SAT Vocab - Spaced Repetition App';

    // Mobile top bar
    const mobileIcon = document.getElementById('mobile-logo-icon');
    if (mobileIcon) mobileIcon.innerText = deckIcon;
    const mobileTitle = document.getElementById('mobile-logo-title');
    if (mobileTitle) mobileTitle.innerText = `${deckName}`;
    const mobileIndicator = document.getElementById('mobile-deck-indicator');
    if (mobileIndicator) mobileIndicator.innerText = isNata ? 'NATA' : 'SAT';

    // Sidebar
    const sidebarIcon = document.getElementById('sidebar-logo-icon');
    if (sidebarIcon) sidebarIcon.innerText = deckIcon;
    const sidebarTitle = document.getElementById('sidebar-logo-title');
    if (sidebarTitle) sidebarTitle.innerText = `${deckName}`;

    const btnDeckNata = document.getElementById('btn-deck-nata');
    if (btnDeckNata) btnDeckNata.classList.toggle('active', isNata);
    const btnDeckSat = document.getElementById('btn-deck-sat');
    if (btnDeckSat) btnDeckSat.classList.toggle('active', !isNata);

    // Dashboard banner pill
    const dashIcon = document.getElementById('dashboard-deck-icon');
    if (dashIcon) dashIcon.innerText = deckIcon;
    const dashLabel = document.getElementById('dashboard-deck-label');
    if (dashLabel) dashLabel.innerText = isNata ? 'NATA & Architecture Master Deck' : 'SAT Vocabulary Deck';
    const dashCount = document.getElementById('dashboard-deck-count');
    if (dashCount) dashCount.innerText = `${totalWords} cards`;

    // Dashboard toggle button
    const dashToggleIcon = document.getElementById('dashboard-toggle-icon');
    if (dashToggleIcon) dashToggleIcon.innerText = isNata ? '🎓' : '🏛️';
    const dashToggleText = document.getElementById('dashboard-toggle-text');
    if (dashToggleText) dashToggleText.innerText = isNata ? 'Switch to SAT Vocab' : 'Switch to NATA Arch';

    // Settings dropdown selector
    const settingSelect = document.getElementById('setting-deck-select');
    if (settingSelect) settingSelect.value = state.activeDeck;
}

// Switch between active curriculum decks ('nata' vs 'sat')
async function switchDeck(newDeck) {
    if (!newDeck || (state.activeDeck === newDeck && state.fullVocabList.length > 0)) return;

    // 1. Save active session state for previous deck before switching
    syncSession();

    // 2. Update state and localStorage
    state.activeDeck = newDeck;
    localStorage.setItem('Active_Deck', newDeck);

    // 3. Clear temporary batch/quiz/review variables in memory
    state.currentBatch = [];
    state.currentWordIndex = 0;
    state.learnAnswers = [];
    state.isCardFlipped = false;
    state.quizQuestions = [];
    state.currentQuizIndex = 0;
    state.quizState = 'question';
    state.quizCorrectCount = 0;
    state.reviewType = null;
    state.reviewQueue = [];
    state.currentReviewIndex = 0;
    state.isReviewFlipped = false;
    state.reviewAnswers = [];
    state.reviewState = 'setup';

    // 4. Reload database data for target deck
    await loadDatabase();

    // 5. Update UI widgets
    updateDeckUI();

    // 6. Restore any previous session for the new deck
    restoreSession();

    // 7. Rerender screen
    navigateTo(state.currentScreen || 'dashboard');

    const label = newDeck === 'nata' ? 'NATA & Architecture Deck' : 'SAT Vocab Deck';
    showToast(`Switched active deck to ${label}!`, 'info');
}

// Restore saved session state
function restoreSession() {
    const saved = loadSessionState(state.activeDeck);
    if (!saved) return;

    state.currentScreen = saved.currentScreen || 'dashboard';
    
    // Restore study batch states
    if (saved.currentBatch && saved.currentBatch.length > 0) {
        state.currentBatch = saved.currentBatch;
        state.currentWordIndex = saved.currentWordIndex || 0;
        state.learnAnswers = saved.learnAnswers || Array(saved.currentBatch.length).fill(null);
    }
    
    // Restore quiz states
    if (saved.quizQuestions && saved.quizQuestions.length > 0) {
        state.quizQuestions = saved.quizQuestions;
        state.currentQuizIndex = saved.currentQuizIndex || 0;
        state.quizState = 'question'; // Reset to question so choices remain interactive
        state.quizCorrectCount = saved.quizCorrectCount || 0;
    }

    // Restore review states
    if (saved.reviewQueue && saved.reviewQueue.length > 0) {
        state.reviewQueue = saved.reviewQueue;
        state.reviewType = saved.reviewType;
        state.currentReviewIndex = saved.currentReviewIndex || 0;
        state.reviewAnswers = saved.reviewAnswers || Array(saved.reviewQueue.length).fill(null);
        state.reviewState = saved.reviewState || 'setup';
    }

    navigateTo(state.currentScreen);
}

// Save active session state to survive page reloads
function syncSession() {
    saveSessionState({
        currentScreen: state.currentScreen,
        currentBatch: state.currentBatch,
        currentWordIndex: state.currentWordIndex,
        learnAnswers: state.learnAnswers,
        quizQuestions: state.quizQuestions,
        currentQuizIndex: state.currentQuizIndex,
        quizState: state.quizState,
        quizCorrectCount: state.quizCorrectCount,
        reviewType: state.reviewType,
        reviewQueue: state.reviewQueue,
        currentReviewIndex: state.currentReviewIndex,
        reviewAnswers: state.reviewAnswers,
        reviewState: state.reviewState
    }, state.activeDeck);
}

// Core screen navigation
function navigateTo(screenId) {
    // If navigating to Learn but no batch is loaded, automatically start one
    if (screenId === 'learn' && state.currentBatch.length === 0) {
        startLearnSession();
        return;
    }

    // If navigating to Quiz but questions aren't generated yet and batch exists, auto-start quiz
    if (screenId === 'quiz' && state.quizQuestions.length === 0 && state.currentBatch.length > 0) {
        startQuizSession();
        return;
    }

    state.currentScreen = screenId;
    
    // Auto-close mobile drawer when navigating
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebar-backdrop')?.classList.remove('active');

    // Update active screen elements
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    
    const activeScreen = document.getElementById(`screen-${screenId}`);
    if (activeScreen) {
        activeScreen.classList.add('active');
    }

    // Update desktop sidebar styles
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
    });
    const navBtn = document.querySelector(`.nav-item[data-screen="${screenId}"]`);
    if (navBtn) {
        navBtn.classList.add('active');
    }

    // Update mobile bottom nav styles
    document.querySelectorAll('.mobile-nav-item').forEach(mobNav => {
        mobNav.classList.remove('active');
    });
    const mobNavBtn = document.querySelector(`.mobile-nav-item[data-screen="${screenId}"]`);
    if (mobNavBtn) {
        mobNavBtn.classList.add('active');
    }

    // Execute screen-specific setup
    if (screenId === 'dashboard') {
        renderDashboard();
    } else if (screenId === 'learn') {
        renderLearnCard();
    } else if (screenId === 'quiz') {
        renderQuizQuestion();
    } else if (screenId === 'review') {
        renderReviewScreen();
    } else if (screenId === 'stats') {
        renderStats();
    }

    syncSession();
}

// Helper to setup touch swipe gestures on flashcards
function setupTouchGestures(elementId, onSwipeLeft, onSwipeRight) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let isVerticalScroll = false;

    el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        isVerticalScroll = false;
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        const deltaX = Math.abs(e.touches[0].clientX - startX);
        const deltaY = Math.abs(e.touches[0].clientY - startY);
        // If vertical movement is dominant, user is scrolling through definitions/examples
        if (deltaY > deltaX && deltaY > 8) {
            isVerticalScroll = true;
        }
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
        if (isVerticalScroll) return; // Ignore if user was vertically scrolling
        if (e.changedTouches.length !== 1) return;

        const deltaX = e.changedTouches[0].clientX - startX;
        const deltaY = e.changedTouches[0].clientY - startY;
        const deltaTime = Date.now() - startTime;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        // Horizontal swipe detected (threshold: >= 45px, dominantly horizontal, within 500ms)
        if (absX >= 45 && absX > absY * 1.5 && deltaTime < 500) {
            if (deltaX < 0) {
                onSwipeLeft(); // Swiped left -> Next
            } else {
                onSwipeRight(); // Swiped right -> Previous
            }
        }
    }, { passive: true });
}

// Setup events for sidebar clicks, mobile navigation, and buttons
function setupEventListeners() {
    // Desktop navigation items
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.addEventListener('click', (e) => {
            const screen = e.currentTarget.getAttribute('data-screen');
            navigateTo(screen);
        });
    });

    // Mobile bottom navigation items
    document.querySelectorAll('.mobile-nav-item').forEach(mobNav => {
        mobNav.addEventListener('click', (e) => {
            const screen = e.currentTarget.getAttribute('data-screen');
            navigateTo(screen);
        });
    });

    // Mobile drawer toggle & close
    const sidebarToggleBtn = document.getElementById('btn-sidebar-toggle');
    const sidebarCloseBtn = document.getElementById('btn-sidebar-close');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    const sidebarEl = document.getElementById('sidebar');

    const toggleDrawer = (open) => {
        if (sidebarEl) sidebarEl.classList.toggle('open', open);
        if (sidebarBackdrop) sidebarBackdrop.classList.toggle('active', open);
    };

    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => {
            const isOpen = sidebarEl ? sidebarEl.classList.contains('open') : false;
            toggleDrawer(!isOpen);
        });
    }

    if (sidebarCloseBtn) {
        sidebarCloseBtn.addEventListener('click', () => toggleDrawer(false));
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', () => toggleDrawer(false));
    }

    // Curriculum Deck Switcher buttons
    document.getElementById('btn-deck-nata')?.addEventListener('click', () => {
        switchDeck('nata');
    });
    document.getElementById('btn-deck-sat')?.addEventListener('click', () => {
        switchDeck('sat');
    });
    document.getElementById('btn-mobile-deck-toggle')?.addEventListener('click', () => {
        switchDeck(state.activeDeck === 'nata' ? 'sat' : 'nata');
    });
    document.getElementById('btn-dashboard-toggle-deck')?.addEventListener('click', () => {
        switchDeck(state.activeDeck === 'nata' ? 'sat' : 'nata');
    });
    document.getElementById('setting-deck-select')?.addEventListener('change', (e) => {
        switchDeck(e.target.value);
    });

    // Dashboard actions
    document.getElementById('btn-start-learn').addEventListener('click', () => {
        startLearnSession();
    });
    document.getElementById('btn-start-quiz').addEventListener('click', () => {
        if (state.quizQuestions.length === 0) {
            startQuizSession();
        } else {
            navigateTo('quiz');
        }
    });

    // Discard batch action
    const resetBatchBtn = document.getElementById('btn-reset-batch');
    if (resetBatchBtn) {
        resetBatchBtn.addEventListener('click', () => {
            if (confirm('Discard the current study batch and start a fresh one?')) {
                state.currentBatch = [];
                state.currentWordIndex = 0;
                state.learnAnswers = [];
                clearSessionState(state.activeDeck);
                renderDashboard();
                showToast('Study batch discarded. Ready for a new batch!', 'info');
            }
        });
    }

    // Learn Screen navigation
    document.getElementById('btn-learn-prev').addEventListener('click', () => {
        navigateLearn(-1);
    });
    document.getElementById('btn-learn-next').addEventListener('click', () => {
        navigateLearn(1);
    });

    // Scroll-safe card flip on Learn screen
    let learnCardMoved = false;
    const learnCard = document.getElementById('flashcard');
    if (learnCard) {
        learnCard.addEventListener('touchstart', () => { learnCardMoved = false; }, { passive: true });
        learnCard.addEventListener('touchmove', () => { learnCardMoved = true; }, { passive: true });
        learnCard.addEventListener('click', () => {
            if (learnCardMoved) {
                learnCardMoved = false;
                return;
            }
            flipCard();
        });
    }

    // Swipe gesture support on Learn flashcard
    setupTouchGestures('flashcard', () => navigateLearn(1), () => navigateLearn(-1));

    document.getElementById('btn-exit-learn').addEventListener('click', () => {
        navigateTo('dashboard');
    });
    document.getElementById('btn-proceed-to-quiz').addEventListener('click', () => {
        startQuizSession();
    });

    // Feedback rating buttons (Easy, Hard, Learning, Forgot)
    document.querySelectorAll('.btn-feedback').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const val = e.currentTarget.getAttribute('data-val');
            submitLearnFeedback(val);
        });
    });

    // Quiz MCQ Choice buttons
    document.querySelectorAll('.choice-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            selectQuizChoice(idx);
        });
    });
    document.getElementById('btn-quiz-continue').addEventListener('click', () => {
        advanceQuiz();
    });
    document.getElementById('btn-exit-quiz').addEventListener('click', () => {
        navigateTo('dashboard');
    });
    document.getElementById('btn-quiz-finish').addEventListener('click', () => {
        navigateTo('dashboard');
    });

    // Quiz Empty State Buttons
    document.getElementById('btn-quiz-empty-study')?.addEventListener('click', () => {
        startLearnSession();
    });
    document.getElementById('btn-quiz-empty-review')?.addEventListener('click', () => {
        launchReviewSession('due');
    });

    // Review setup launchers
    document.getElementById('btn-rev-due').addEventListener('click', () => {
        launchReviewSession('due');
    });
    document.getElementById('btn-rev-weak').addEventListener('click', () => {
        launchReviewSession('weak');
    });
    document.getElementById('btn-rev-missed').addEventListener('click', () => {
        launchReviewSession('missed');
    });

    // Scroll-safe card flip on Review screen
    let reviewCardMoved = false;
    const revCard = document.getElementById('review-flashcard');
    if (revCard) {
        revCard.addEventListener('touchstart', () => { reviewCardMoved = false; }, { passive: true });
        revCard.addEventListener('touchmove', () => { reviewCardMoved = true; }, { passive: true });
        revCard.addEventListener('click', () => {
            if (reviewCardMoved) {
                reviewCardMoved = false;
                return;
            }
            flipReviewCard();
        });
    }

    // Swipe gesture support on Review flashcard
    setupTouchGestures('review-flashcard', () => navigateReview(1), () => navigateReview(-1));

    document.getElementById('btn-review-prev').addEventListener('click', () => {
        navigateReview(-1);
    });
    document.getElementById('btn-review-next').addEventListener('click', () => {
        navigateReview(1);
    });
    document.getElementById('btn-exit-active-review').addEventListener('click', () => {
        endReviewSession();
    });
    document.getElementById('btn-review-finish').addEventListener('click', () => {
        endReviewSession();
    });

    // Review ratings
    document.querySelectorAll('.btn-review-feedback').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const val = e.currentTarget.getAttribute('data-val');
            submitReviewFeedback(val);
        });
    });

    // Settings actions
    document.getElementById('btn-export-progress').addEventListener('click', async () => {
        try {
            await exportProgress(state.activeDeck);
            showToast(`Progress for ${state.activeDeck.toUpperCase()} exported successfully!`, 'success');
        } catch (err) {
            showToast('Backup export failed.', 'danger');
        }
    });

    // Trigger Import File Dialog
    document.getElementById('btn-trigger-import').addEventListener('click', () => {
        document.getElementById('file-import-progress').click();
    });
    document.getElementById('file-import-progress').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const count = await importProgress(event.target.result);
                await loadDatabase();
                navigateTo('dashboard');
                showToast(`Successfully imported ${count} progress records.`, 'success');
            } catch (err) {
                showToast('Import failed. Invalid JSON format.', 'danger');
            }
        };
        reader.readAsText(file);
    });

    // Trigger Markdown Import File Dialog
    document.getElementById('btn-trigger-markdown-import').addEventListener('click', () => {
        document.getElementById('file-import-markdown').click();
    });
    document.getElementById('file-import-markdown').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const text = event.target.result;
                let parsedWords = [];
                let deckType = state.activeDeck;

                if (text.includes('NATA') || text.includes('Part A:') || text.includes('Part B:')) {
                    parsedWords = parseNataVocab(text);
                    deckType = 'nata';
                } else {
                    parsedWords = parseVocab(text);
                }

                if (parsedWords.length === 0) {
                    throw new Error('No words parsed.');
                }
                await saveVocabList(parsedWords, deckType);
                state.activeDeck = deckType;
                localStorage.setItem('Active_Deck', deckType);
                await loadDatabase();
                clearSessionState(deckType);
                state.currentBatch = [];
                state.quizQuestions = [];
                state.reviewQueue = [];
                updateDeckUI();
                navigateTo('dashboard');
                showToast(`Successfully parsed and loaded ${parsedWords.length} words for ${deckType.toUpperCase()}!`, 'success');
            } catch (err) {
                showToast('Parsing failed. Make sure the structure is correct.', 'danger');
            }
        };
        reader.readAsText(file);
    });

    // Reset buttons
    document.getElementById('btn-reset-progress').addEventListener('click', async () => {
        if (confirm(`Are you sure you want to clear your study progress for the ${state.activeDeck.toUpperCase()} deck? Your vocabulary list will be saved.`)) {
            await resetProgress(state.activeDeck);
            await loadDatabase();
            clearSessionState(state.activeDeck);
            state.currentBatch = [];
            state.quizQuestions = [];
            state.reviewQueue = [];
            navigateTo('dashboard');
            showToast(`${state.activeDeck.toUpperCase()} progress history cleared.`, 'success');
        }
    });

    document.getElementById('btn-reset-all').addEventListener('click', async () => {
        if (confirm('WARNING: This will completely delete the database (vocabulary and progress). The app will reload the default list.')) {
            await resetAll();
            await loadDatabase();
            clearSessionState();
            state.currentBatch = [];
            state.quizQuestions = [];
            state.reviewQueue = [];
            navigateTo('dashboard');
            showToast('Database wiped and reset.', 'success');
        }
    });
}

// Calculate statistics and update Dashboard UI
function renderDashboard() {
    updateDeckUI();
    const totalCount = state.fullVocabList.length;
    const progressMap = new Map(state.progressList.map(p => [p.wordId, p]));
    
    let learnedCount = 0;
    let masteredCount = 0;
    let weakCount = 0;
    let dueCount = 0;
    
    const dist = { new: 0, learning: 0, review: 0, mastered: 0, weak: 0 };
    const now = Date.now();

    state.fullVocabList.forEach(vocab => {
        const prog = progressMap.get(vocab.id);
        if (prog) {
            if (prog.status !== 'new') learnedCount++;
            if (prog.mastered) masteredCount++;
            if (prog.weak) weakCount++;
            
            // Due check
            if (prog.nextReviewAt && prog.nextReviewAt <= now && prog.status !== 'new') {
                dueCount++;
            }
            
            dist[prog.status] = (dist[prog.status] || 0) + 1;
        } else {
            dist.new++;
        }
    });

    const masteryRate = learnedCount > 0 ? (masteredCount / totalCount) * 100 : 0;
    
    // Update Dashboard UI Counters
    updateDashboardStats({
        learnedCount,
        totalCount,
        masteryRate,
        weakCount,
        dueCount,
        streak: state.streak,
        dist
    });

    // Format current date on dashboard header
    const dateEl = document.getElementById('dashboard-date');
    if (dateEl) {
        const today = new Date();
        const options = { weekday: 'long', month: 'short', day: 'numeric' };
        dateEl.innerText = `${today.toLocaleDateString(undefined, options)} • Welcome back!`;
    }

    // Update study batch cards/buttons state
    const studyBtn = document.getElementById('btn-start-learn');
    const quizBtn = document.getElementById('btn-start-quiz');
    const resetBatchBtn = document.getElementById('btn-reset-batch');
    const progressFill = document.getElementById('batch-progress-fill');
    const stepText = document.getElementById('batch-step-text');
    const percentText = document.getElementById('batch-percent-text');

    if (state.currentBatch.length > 0) {
        studyBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>Resume Current Batch</span>
        `;
        
        // Count how many cards in the current batch have feedback
        const answeredCount = state.learnAnswers.filter(a => a !== null).length;
        const progressPct = (answeredCount / state.currentBatch.length) * 100;
        
        progressFill.style.width = `${progressPct}%`;
        percentText.innerText = `${Math.round(progressPct)}%`;
        
        if (answeredCount === state.currentBatch.length) {
            stepText.innerText = 'Batch Studied! Quiz is ready.';
            quizBtn.disabled = false;
        } else {
            stepText.innerText = `Learning batch: Card ${state.currentWordIndex + 1} of ${state.currentBatch.length}`;
            // Allow user to take quiz even if they haven't finished all cards, if at least 1 studied
            quizBtn.disabled = false;
        }

        if (resetBatchBtn) resetBatchBtn.style.display = 'inline-flex';
    } else {
        studyBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <span>Study Next Batch (10 words)</span>
        `;
        progressFill.style.width = '0%';
        percentText.innerText = '0%';
        stepText.innerText = 'Ready to generate a new session batch.';
        quizBtn.disabled = true;
        if (resetBatchBtn) resetBatchBtn.style.display = 'none';
    }
}

// Generate the next study batch and navigate to Learn
function startLearnSession() {
    if (state.currentBatch.length === 0) {
        // Generate a new batch of 10 words (deconflictLetters already applied in scheduler)
        const batch = generateSessionQueue(state.fullVocabList, state.progressList, 10);
        
        if (batch.length === 0) {
            showToast('All words mastered! Go to Review screen.', 'info');
            return;
        }

        state.currentBatch = batch;
        state.currentWordIndex = 0;
        state.learnAnswers = Array(batch.length).fill(null);
        state.isCardFlipped = false;
    }

    navigateTo('learn');
}

// Render active flashcard
function renderLearnCard() {
    if (state.currentBatch.length === 0) return;

    const wordItem = state.currentBatch[state.currentWordIndex];
    const progress = wordItem.progress || { status: 'new' };
    
    // Front card values
    document.getElementById('card-word-front').innerText = wordItem.word;
    document.getElementById('card-pos-front').innerText = wordItem.partOfSpeech;
    
    const statusPillFront = document.getElementById('card-status-front');
    statusPillFront.innerText = progress.status;
    statusPillFront.className = `badge badge-status status-${progress.status}`;

    // Front badges (Category & Priority)
    const catFront = document.getElementById('card-cat-front');
    if (catFront) {
        if (wordItem.category) {
            catFront.innerText = wordItem.category;
            catFront.style.display = 'inline-block';
        } else {
            catFront.style.display = 'none';
        }
    }
    const prioFront = document.getElementById('card-prio-front');
    if (prioFront) {
        if (wordItem.priority) {
            prioFront.innerText = wordItem.priority;
            prioFront.className = `badge badge-priority priority-${wordItem.priority.toLowerCase()}`;
            prioFront.style.display = 'inline-block';
        } else {
            prioFront.style.display = 'none';
        }
    }

    // Back card values
    document.getElementById('card-word-back').innerText = wordItem.word;
    document.getElementById('card-pos-back').innerText = wordItem.partOfSpeech;
    document.getElementById('card-pos-subtitle-back').innerText = wordItem.partOfSpeech;
    
    const statusPillBack = document.getElementById('card-status-back');
    statusPillBack.innerText = progress.status;
    statusPillBack.className = `badge badge-status status-${progress.status}`;

    // Back badges (Category & Priority)
    const catBack = document.getElementById('card-cat-back');
    if (catBack) {
        if (wordItem.category) {
            catBack.innerText = wordItem.category;
            catBack.style.display = 'inline-block';
        } else {
            catBack.style.display = 'none';
        }
    }
    const prioBack = document.getElementById('card-prio-back');
    if (prioBack) {
        if (wordItem.priority) {
            prioBack.innerText = wordItem.priority;
            prioBack.className = `badge badge-priority priority-${wordItem.priority.toLowerCase()}`;
            prioBack.style.display = 'inline-block';
        } else {
            prioBack.style.display = 'none';
        }
    }

    // Render senses
    const sensesContainer = document.getElementById('card-senses-container');
    renderSensesList(sensesContainer, wordItem.senses);

    // Title / Subtitle updates
    document.getElementById('learn-progress-subtitle').innerText = `Word ${state.currentWordIndex + 1} of ${state.currentBatch.length}`;

    // Indicators (Dots)
    const indicatorsContainer = document.getElementById('learn-indicators');
    const results = state.learnAnswers.map(ans => {
        if (ans === null) return null;
        return ans === 'correct' || ans === 'learning';
    });
    renderIndicators(indicatorsContainer, state.currentBatch.length, state.currentWordIndex, results);

    // Apply card flip state visually
    const cardEl = document.getElementById('flashcard');
    if (state.isCardFlipped) {
        cardEl.classList.add('flipped');
    } else {
        cardEl.classList.remove('flipped');
    }
    enableFeedbackPanel(true);

    // Toggle finish card or nav buttons
    const batchCompleteEl = document.getElementById('batch-complete-card');
    const proceedBtn = document.getElementById('btn-proceed-to-quiz');
    if (proceedBtn) {
        proceedBtn.innerText = `Start MCQ Quiz (${state.currentBatch.length} Questions)`;
    }
    
    // If all cards rated, or on the last card with feedback
    const allAnswered = state.learnAnswers.every(ans => ans !== null);
    if (allAnswered && state.currentWordIndex === state.currentBatch.length - 1) {
        batchCompleteEl.style.display = 'block';
    } else {
        batchCompleteEl.style.display = 'none';
    }
}

// Flip flashcard mechanically
function flipCard() {
    state.isCardFlipped = !state.isCardFlipped;
    const cardEl = document.getElementById('flashcard');
    if (state.isCardFlipped) {
        cardEl.classList.add('flipped');
        enableFeedbackPanel(true);
    } else {
        cardEl.classList.remove('flipped');
        enableFeedbackPanel(false);
    }
    syncSession();
}

function enableFeedbackPanel(enable) {
    const panel = document.getElementById('learning-feedback-panel');
    if (enable) {
        panel.style.opacity = '1';
        panel.style.pointerEvents = 'auto';
    } else {
        panel.style.opacity = '0.5';
        panel.style.pointerEvents = 'none';
    }
}

// Navigation in learning carousel
function navigateLearn(direction) {
    const nextIdx = state.currentWordIndex + direction;
    if (nextIdx >= 0 && nextIdx < state.currentBatch.length) {
        state.currentWordIndex = nextIdx;
        state.isCardFlipped = false;
        renderLearnCard();
        syncSession();
    } else if (nextIdx >= state.currentBatch.length) {
        // Reached end of batch - show batch completion card
        const batchCompleteEl = document.getElementById('batch-complete-card');
        if (batchCompleteEl) {
            batchCompleteEl.style.display = 'block';
            batchCompleteEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

// Rating feedback submissions
async function submitLearnFeedback(rating) {
    state.learnAnswers[state.currentWordIndex] = rating;
    
    // Save locally
    syncSession();
    renderLearnCard();

    // Auto advance after short delay if there is a next card
    if (state.currentWordIndex < state.currentBatch.length - 1) {
        setTimeout(() => {
            navigateLearn(1);
        }, 300);
    } else {
        // Checked all cards in the batch
        const allAnswered = state.learnAnswers.every(ans => ans !== null);
        if (allAnswered) {
            const batchCompleteEl = document.getElementById('batch-complete-card');
            if (batchCompleteEl) batchCompleteEl.style.display = 'block';
        }
    }
}

// Setup quiz questions based on active batch
function startQuizSession() {
    if (state.currentBatch.length === 0) return;

    // Generate MCQs from current batch
    state.quizQuestions = generateQuiz(state.currentBatch, state.fullVocabList);
    state.currentQuizIndex = 0;
    state.selectedQuizOption = null;
    state.quizState = 'question';
    state.quizCorrectCount = 0;

    navigateTo('quiz');
}

// Render active MCQ question
function renderQuizQuestion() {
    const qResultsCard = document.getElementById('quiz-results-card');
    const qMainCard = document.querySelector('.quiz-card');
    const qEmptyCard = document.getElementById('quiz-empty-card');

    if (state.quizQuestions.length === 0) {
        if (qMainCard) qMainCard.style.display = 'none';
        if (qResultsCard) qResultsCard.style.display = 'none';
        if (qEmptyCard) qEmptyCard.style.display = 'flex';
        return;
    }
    if (qEmptyCard) qEmptyCard.style.display = 'none';

    if (state.quizState === 'complete') {
        // Render MCQ completion score card
        qMainCard.style.display = 'none';
        qResultsCard.style.display = 'block';
        
        const pct = (state.quizCorrectCount / state.quizQuestions.length) * 100;
        document.getElementById('quiz-score-percent').innerText = `${Math.round(pct)}%`;
        document.getElementById('quiz-score-ratio').innerText = `${state.quizCorrectCount} / ${state.quizQuestions.length}`;
        
        let msg = 'Great study session! Spaced repetition intervals have been pushed.';
        if (pct === 100) msg = 'Flawless victory! 🏆 All intervals maximized!';
        else if (pct < 60) msg = 'Review these words soon to reinforce your memory.';
        document.getElementById('quiz-results-summary').innerText = msg;
        return;
    }

    qMainCard.style.display = 'flex';
    qResultsCard.style.display = 'none';

    const question = state.quizQuestions[state.currentQuizIndex];
    document.getElementById('quiz-progress-subtitle').innerText = `Question ${state.currentQuizIndex + 1} of ${state.quizQuestions.length}`;
    document.getElementById('quiz-word-pos').innerText = question.partOfSpeech;
    document.getElementById('quiz-question-text').innerHTML = question.questionText;

    // Choices
    const choicesContainer = document.getElementById('quiz-choices-grid');
    choicesContainer.innerHTML = '';

    question.choices.forEach((choice, idx) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.setAttribute('data-idx', idx);
        
        const letter = String.fromCharCode(65 + idx); // A, B, C, D
        
        // POS tags on choices if it's a "word match" question
        let posTag = '';
        if (question.type === 'word' && choice.partOfSpeech) {
            posTag = `<small class="badge badge-pos" style="margin-left:auto;">${choice.partOfSpeech}</small>`;
        }

        btn.innerHTML = `
            <span class="choice-letter">${letter}</span>
            <span class="choice-text">${choice.text}</span>
            ${posTag}
        `;
        
        // Add click listener
        btn.addEventListener('click', () => selectQuizChoice(idx));
        
        choicesContainer.appendChild(btn);
    });

    // Hide feedback panel
    document.getElementById('quiz-feedback-box').style.display = 'none';
}

// User selects an option in MCQ
async function selectQuizChoice(optionIdx) {
    if (state.quizState !== 'question') return;

    state.selectedQuizOption = optionIdx;
    state.quizState = 'feedback';

    const question = state.quizQuestions[state.currentQuizIndex];
    const choicesContainer = document.getElementById('quiz-choices-grid');
    const buttons = choicesContainer.querySelectorAll('.choice-btn');

    const isCorrect = optionIdx === question.correctIndex;
    
    // Highlight correct & incorrect buttons
    buttons.forEach((btn, idx) => {
        btn.classList.add('disabled');
        if (idx === question.correctIndex) {
            btn.classList.add('correct');
        } else if (idx === optionIdx && !isCorrect) {
            btn.classList.add('incorrect');
        }
    });

    if (isCorrect) {
        state.quizCorrectCount++;
    }

    // Perform spaced repetition database updates instantly!
    const targetWordId = question.wordId;
    const currentProgress = await getProgressForWord(targetWordId);
    
    // Update progress using scheduler engine
    const updatedProgress = updateProgress(currentProgress, isCorrect);
    await saveProgress(updatedProgress);

    // Refresh database cache
    state.progressList = await getAllProgress(state.activeDeck);

    // Daily streak check
    markStudyActivity();

    // Show feedback overlays (definition reveal & examples)
    const feedbackBox = document.getElementById('quiz-feedback-box');
    const statusText = document.getElementById('quiz-feedback-status');
    const revealMeaning = document.getElementById('quiz-reveal-meaning');
    const revealExample = document.getElementById('quiz-reveal-example');
    const exampleBox = document.getElementById('quiz-reveal-example-box');

    if (isCorrect) {
        statusText.innerText = 'Correct Answer!';
        statusText.className = 'feedback-status-badge font-green';
    } else {
        statusText.innerText = `Incorrect. The correct answer was: "${question.correctAnswerText}"`;
        statusText.className = 'feedback-status-badge font-red';
    }

    // Reveal meaning details
    const targetVocab = state.fullVocabList.find(w => w.id === targetWordId);
    if (targetVocab) {
        revealMeaning.innerText = targetVocab.senses.map(s => s.meaning).join(' | ');
        const exampleText = targetVocab.senses.map(s => s.example).filter(Boolean).join(' / ');
        if (exampleText) {
            exampleBox.style.display = 'block';
            revealExample.innerText = exampleText;
        } else {
            exampleBox.style.display = 'none';
        }
    }

    feedbackBox.style.display = 'block';
    
    // Focus continue button
    document.getElementById('btn-quiz-continue').focus();

    syncSession();
}

// Proceed to next quiz question
function advanceQuiz() {
    if (state.quizState !== 'feedback') return;

    if (state.currentQuizIndex < state.quizQuestions.length - 1) {
        state.currentQuizIndex++;
        state.quizState = 'question';
        state.selectedQuizOption = null;
        renderQuizQuestion();
    } else {
        // Quiz completed
        state.quizState = 'complete';
        
        // Reset study batch after completion so next batch is loaded next time
        state.currentBatch = [];
        clearSessionState();
        
        renderQuizQuestion();
    }
    syncSession();
}

// Active reviews launcher
async function launchReviewSession(type) {
    const now = Date.now();
    const progressMap = new Map(state.progressList.map(p => [p.wordId, p]));
    const queue = [];

    state.fullVocabList.forEach(vocab => {
        const prog = progressMap.get(vocab.id);
        if (prog && prog.status !== 'new') {
            if (type === 'due' && prog.nextReviewAt && prog.nextReviewAt <= now) {
                queue.push({ vocab, progress: prog });
            } else if (type === 'weak' && prog.weak) {
                queue.push({ vocab, progress: prog });
            } else if (type === 'missed' && prog.streak === 0 && prog.seenCount > 0) {
                queue.push({ vocab, progress: prog });
            }
        }
    });

    if (queue.length === 0) {
        showToast(`No words in your "${type}" queue currently!`, 'success');
        return;
    }

    // Sort review queue (oldest studied first)
    queue.sort((a, b) => (a.progress.lastSeenAt || 0) - (b.progress.lastSeenAt || 0));

    // Limit review queue sizes to 15 per batch to keep reviews manageable
    const items = queue.slice(0, 15).map(q => ({
        ...q.vocab,
        progress: q.progress
    }));

    // Shuffle the selected review items to randomize presentation order
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }

    state.reviewType = type;
    state.reviewQueue = items;
    state.currentReviewIndex = 0;
    state.reviewAnswers = Array(items.length).fill(null);
    state.isReviewFlipped = false;
    state.reviewState = 'active';

    navigateTo('review');
}

// Render review layout
function renderReviewScreen() {
    const launcherEl = document.querySelector('.review-launcher');
    const activeEl = document.getElementById('review-active-container');
    const completeEl = document.getElementById('review-complete-card');

    // Update Counts on options
    const now = Date.now();
    const progressMap = new Map(state.progressList.map(p => [p.wordId, p]));
    
    let dueCount = 0;
    let weakCount = 0;
    let missedCount = 0;

    state.fullVocabList.forEach(vocab => {
        const prog = progressMap.get(vocab.id);
        if (prog && prog.status !== 'new') {
            if (prog.nextReviewAt && prog.nextReviewAt <= now) dueCount++;
            if (prog.weak) weakCount++;
            if (prog.streak === 0 && prog.seenCount > 0) missedCount++;
        }
    });

    document.getElementById('rev-due-count').innerText = dueCount;
    document.getElementById('rev-weak-count').innerText = weakCount;
    document.getElementById('rev-missed-count').innerText = missedCount;

    if (state.reviewState === 'setup') {
        launcherEl.style.display = 'block';
        activeEl.style.display = 'none';
        completeEl.style.display = 'none';
        return;
    }

    if (state.reviewState === 'complete') {
        launcherEl.style.display = 'none';
        activeEl.style.display = 'none';
        completeEl.style.display = 'block';
        return;
    }

    launcherEl.style.display = 'none';
    activeEl.style.display = 'flex';
    completeEl.style.display = 'none';

    // Active card review details
    const wordItem = state.reviewQueue[state.currentReviewIndex];
    const progress = wordItem.progress;

    // Headers
    document.getElementById('review-type-title').innerText = `${state.reviewType.toUpperCase()} Session`;
    document.getElementById('review-active-progress').innerText = `Word ${state.currentReviewIndex + 1} of ${state.reviewQueue.length}`;

    // Front Card
    document.getElementById('rev-word-front').innerText = wordItem.word;
    document.getElementById('rev-pos-front').innerText = wordItem.partOfSpeech;
    
    const statusFront = document.getElementById('rev-status-front');
    statusFront.innerText = progress.status;
    statusFront.className = `badge badge-status status-${progress.status}`;

    // Front review badges (Category & Priority)
    const revCatFront = document.getElementById('rev-cat-front');
    if (revCatFront) {
        if (wordItem.category) {
            revCatFront.innerText = wordItem.category;
            revCatFront.style.display = 'inline-block';
        } else {
            revCatFront.style.display = 'none';
        }
    }
    const revPrioFront = document.getElementById('rev-prio-front');
    if (revPrioFront) {
        if (wordItem.priority) {
            revPrioFront.innerText = wordItem.priority;
            revPrioFront.className = `badge badge-priority priority-${wordItem.priority.toLowerCase()}`;
            revPrioFront.style.display = 'inline-block';
        } else {
            revPrioFront.style.display = 'none';
        }
    }

    // Back Card
    document.getElementById('rev-word-back').innerText = wordItem.word;
    document.getElementById('rev-pos-back').innerText = wordItem.partOfSpeech;
    document.getElementById('rev-pos-subtitle-back').innerText = wordItem.partOfSpeech;
    
    const statusBack = document.getElementById('rev-status-back');
    statusBack.innerText = progress.status;
    statusBack.className = `badge badge-status status-${progress.status}`;

    // Back review badges (Category & Priority)
    const revCatBack = document.getElementById('rev-cat-back');
    if (revCatBack) {
        if (wordItem.category) {
            revCatBack.innerText = wordItem.category;
            revCatBack.style.display = 'inline-block';
        } else {
            revCatBack.style.display = 'none';
        }
    }
    const revPrioBack = document.getElementById('rev-prio-back');
    if (revPrioBack) {
        if (wordItem.priority) {
            revPrioBack.innerText = wordItem.priority;
            revPrioBack.className = `badge badge-priority priority-${wordItem.priority.toLowerCase()}`;
            revPrioBack.style.display = 'inline-block';
        } else {
            revPrioBack.style.display = 'none';
        }
    }

    const sensesContainer = document.getElementById('rev-senses-container');
    renderSensesList(sensesContainer, wordItem.senses);

    // Card Flipping mechanics
    const cardEl = document.getElementById('review-flashcard');
    const feedbackPanel = document.getElementById('review-feedback-panel');

    if (state.isReviewFlipped) {
        cardEl.classList.add('flipped');
    } else {
        cardEl.classList.remove('flipped');
    }
    feedbackPanel.style.opacity = '1';
    feedbackPanel.style.pointerEvents = 'auto';

    // Indicators (Dots)
    const indicatorsContainer = document.getElementById('review-indicators');
    const dotResults = state.reviewAnswers.map(ans => {
        if (ans === null) return null;
        return ans === 'correct';
    });
    renderIndicators(indicatorsContainer, state.reviewQueue.length, state.currentReviewIndex, dotResults);
}

// Flip card in review mode
function flipReviewCard() {
    state.isReviewFlipped = !state.isReviewFlipped;
    renderReviewScreen();
    syncSession();
}

// Carousel navigation in review mode
function navigateReview(direction) {
    const nextIdx = state.currentReviewIndex + direction;
    if (nextIdx >= 0 && nextIdx < state.reviewQueue.length) {
        state.currentReviewIndex = nextIdx;
        state.isReviewFlipped = false;
        renderReviewScreen();
        syncSession();
    }
}

// Handle correct/wrong ratings during review
async function submitReviewFeedback(rating) {
    const isCorrect = rating === 'correct';
    state.reviewAnswers[state.currentReviewIndex] = rating;

    // Apply database updates instantly
    const targetWord = state.reviewQueue[state.currentReviewIndex];
    const currentProgress = await getProgressForWord(targetWord.id);
    
    const updated = updateProgress(currentProgress, isCorrect);
    await saveProgress(updated);

    // Keep active review queue progress in sync
    targetWord.progress = updated;

    // Sync database cache
    state.progressList = await getAllProgress(state.activeDeck);
    markStudyActivity();

    // Auto advance
    if (state.currentReviewIndex < state.reviewQueue.length - 1) {
        setTimeout(() => {
            navigateReview(1);
        }, 300);
    } else {
        // Complete review session
        state.reviewState = 'complete';
        renderReviewScreen();
    }
    syncSession();
}

function endReviewSession() {
    state.reviewState = 'setup';
    state.reviewQueue = [];
    state.reviewAnswers = [];
    navigateTo('review');
}

// Render Stats Screen
function renderStats() {
    const totalCount = state.fullVocabList.length;
    const progressMap = new Map(state.progressList.map(p => [p.wordId, p]));
    
    const weakWords = [];
    const masteredWords = [];
    
    let totalScoreCount = 0;
    let totalCorrectCount = 0;

    state.fullVocabList.forEach(vocab => {
        const prog = progressMap.get(vocab.id);
        if (prog) {
            totalCorrectCount += (prog.correctCount || 0);
            totalScoreCount += (prog.seenCount || 0);

            if (prog.weak) {
                weakWords.push({ ...vocab, progress: prog });
            }
            if (prog.mastered) {
                masteredWords.push({ ...vocab, progress: prog });
            }
        }
    });

    const accuracy = totalScoreCount > 0 ? (totalCorrectCount / totalScoreCount) * 100 : 0;

    // Sort Lists
    // Weakest words (highest wrong count) first
    weakWords.sort((a, b) => (b.progress.wrongCount || 0) - (a.progress.wrongCount || 0));
    // Strongest mastered words (highest streak) first
    masteredWords.sort((a, b) => (b.progress.streak || 0) - (a.progress.streak || 0));

    // Handle Quick Study launcher from stats
    const studyWeakWordCallback = (wordStr) => {
        const item = state.fullVocabList.find(w => w.word === wordStr);
        if (item) {
            const prog = state.progressList.find(p => p.wordId === item.id) || {
                wordId: item.id,
                status: 'weak',
                introduced: true,
                seenCount: 1,
                correctCount: 0,
                wrongCount: 1,
                streak: 0,
                lastSeenAt: Date.now(),
                nextReviewAt: Date.now(),
                mastered: false,
                weak: true
            };
            state.currentBatch = [{ ...item, progress: prog }];
            state.currentWordIndex = 0;
            state.learnAnswers = [null];
            state.isCardFlipped = false;
            navigateTo('learn');
        }
    };

    renderStatsScreen(accuracy, state.streak, weakWords, masteredWords, studyWeakWordCallback);
}

// Global Keyboard Shortcut listener
function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.getElementById('sidebar')?.classList.remove('open');
            document.getElementById('sidebar-backdrop')?.classList.remove('active');
            return;
        }

        // Avoid triggering shortcuts inside form inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            return;
        }

        const key = e.key;
        
        // Routing keys based on active screens
        if (state.currentScreen === 'learn') {
            handleLearnKeys(e, key);
        } else if (state.currentScreen === 'quiz') {
            handleQuizKeys(e, key);
        } else if (state.currentScreen === 'review' && state.reviewState === 'active') {
            handleReviewKeys(e, key);
        }
    });
}

function handleLearnKeys(e, key) {
    if (key === 'ArrowLeft') {
        e.preventDefault();
        navigateLearn(-1);
    } else if (key === 'ArrowRight') {
        e.preventDefault();
        
        const allAnswered = state.learnAnswers.every(ans => ans !== null);
        if (allAnswered && state.currentWordIndex === state.currentBatch.length - 1) {
            // Proceed to quiz directly on right arrow click at the end
            startQuizSession();
        } else {
            navigateLearn(1);
        }
    } else if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        flipCard();
    } else {
        // Quick ratings mapping
        if (key.toLowerCase() === 'w') {
            submitLearnFeedback('wrong');
        } else if (key.toLowerCase() === 's') {
            submitLearnFeedback('weak');
        } else if (key.toLowerCase() === 'd') {
            submitLearnFeedback('learning');
        } else if (key.toLowerCase() === 'f') {
            submitLearnFeedback('correct');
        }
    }
}

function handleQuizKeys(e, key) {
    const k = key.toLowerCase();
    if (state.quizState === 'question') {
        let idx = null;
        if (['1', '2', '3', '4'].includes(key)) {
            idx = parseInt(key, 10) - 1;
        } else if (['a', 'b', 'c', 'd'].includes(k)) {
            idx = k.charCodeAt(0) - 97; // 'a' -> 0, 'b' -> 1, 'c' -> 2, 'd' -> 3
        }
        if (idx !== null && state.quizQuestions[state.currentQuizIndex] && idx < state.quizQuestions[state.currentQuizIndex].choices.length) {
            e.preventDefault();
            selectQuizChoice(idx);
        }
    } else if (state.quizState === 'feedback') {
        if (key === 'Enter' || key === ' ' || key === 'ArrowRight') {
            e.preventDefault();
            advanceQuiz();
        }
    }
}

function handleReviewKeys(e, key) {
    if (key === 'ArrowLeft') {
        e.preventDefault();
        navigateReview(-1);
    } else if (key === 'ArrowRight') {
        e.preventDefault();
        navigateReview(1);
    } else if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        flipReviewCard();
    } else {
        if (key.toLowerCase() === 'w') {
            submitReviewFeedback('wrong');
        } else if (key.toLowerCase() === 'f') {
            submitReviewFeedback('correct');
        }
    }
}

// Direct UI update (runs on initial load)
function updateUI() {
    renderDashboard();
}
