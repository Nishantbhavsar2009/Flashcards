/**
 * Spaced Repetition System (SRS) Scheduler for SAT Vocabulary Study App.
 * Computes intervals, streaks, and priorities.
 */

// SRS Intervals in milliseconds
const INTERVALS = {
    STREAK_0: 1 * 60 * 1000,       // 1 minute (for immediate re-queueing on wrong answer)
    STREAK_1: 5 * 60 * 1000,       // 5 minutes
    STREAK_2: 12 * 60 * 60 * 1000,  // 12 hours
    STREAK_3: 2 * 24 * 60 * 60 * 1000, // 2 days
    STREAK_4: 5 * 24 * 60 * 60 * 1000, // 5 days
    STREAK_5: 10 * 24 * 60 * 60 * 1000, // 10 days
    STREAK_6: 30 * 24 * 60 * 60 * 1000  // 30 days (mastered)
};

/**
 * Shuffles an array in place.
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Reorders a batch of words to prevent consecutive words from starting with the same letter
 * if there are alternatives.
 */
function deconflictLetters(arr) {
    if (arr.length <= 2) return arr;
    const result = [arr[0]];
    const remaining = arr.slice(1);
    
    let attempts = 0;
    while (remaining.length > 0 && attempts < 100) {
        attempts++;
        const lastLetter = result[result.length - 1].word.charAt(0).toLowerCase();
        let foundIdx = -1;
        
        for (let i = 0; i < remaining.length; i++) {
            const char = remaining[i].word.charAt(0).toLowerCase();
            if (char !== lastLetter) {
                foundIdx = i;
                break;
            }
        }
        
        if (foundIdx !== -1) {
            result.push(remaining.splice(foundIdx, 1)[0]);
        } else {
            // Fallback: no different letter remains, just push the first
            result.push(remaining.shift());
        }
    }
    result.push(...remaining); // Append any leftovers if attempts cap hit
    return result;
}

/**
 * Updates a progress record based on correct/incorrect answer.
 * @param {Object} progress The current progress record
 * @param {boolean} isCorrect Whether the user answered correctly
 * @returns {Object} The updated progress record
 */
export function updateProgress(progress, isCorrect) {
    const now = Date.now();
    const updated = { ...progress };

    updated.seenCount = (updated.seenCount || 0) + 1;
    updated.lastSeenAt = now;
    updated.lastAnswerCorrect = isCorrect;
    updated.introduced = true; // Mark as introduced

    if (isCorrect) {
        updated.correctCount = (updated.correctCount || 0) + 1;
        updated.streak = (updated.streak || 0) + 1;

        // Determine next review time based on streak
        let delay = INTERVALS.STREAK_1;
        if (updated.streak === 2) delay = INTERVALS.STREAK_2;
        else if (updated.streak === 3) delay = INTERVALS.STREAK_3;
        else if (updated.streak === 4) delay = INTERVALS.STREAK_4;
        else if (updated.streak === 5) delay = INTERVALS.STREAK_5;
        else if (updated.streak >= 6) delay = INTERVALS.STREAK_6;

        updated.nextReviewAt = now + delay;

        // Promote status
        if (updated.streak >= 6) {
            updated.status = 'mastered';
            updated.mastered = true;
            updated.weak = false;
        } else if (updated.streak >= 3) {
            updated.status = 'review';
            updated.mastered = false;
            updated.weak = false;
        } else {
            updated.status = 'learning';
            updated.mastered = false;
        }
    } else {
        updated.wrongCount = (updated.wrongCount || 0) + 1;
        updated.streak = 0; // reset streak
        updated.nextReviewAt = now + INTERVALS.STREAK_0; // bring back soon (1 min)

        // If previously mastered, demote
        updated.mastered = false;
        
        // Mark as weak
        updated.status = 'weak';
        updated.weak = true;
    }

    return updated;
}

/**
 * Prioritizes and selects the next study batch.
 * Selects 5 random new words and 5 random eligible review words.
 * Eligible review words are:
 * - weak words (weak === true)
 * - recently missed words (streak === 0 and seenCount > 0)
 * - unfinished learning words (status === 'learning')
 * - due reviews (status === 'review'/'mastered' and nextReviewAt <= now)
 * Excludes mastered/review words that are not yet due.
 * 
 * @param {Array} vocabList Full vocabulary array
 * @param {Array} progressList Progress list from DB
 * @param {number} batchSize Size of the batch (default 10)
 * @returns {Array} List of selected vocabulary items with progress attached
 */
export function generateSessionQueue(vocabList, progressList, batchSize = 10) {
    const now = Date.now();
    const progressMap = new Map();
    for (const p of progressList) {
        progressMap.set(p.wordId, p);
    }

    // Classify all words into either New or Review categories
    const newPool = [];
    const reviewPool = [];

    vocabList.forEach(vocab => {
        const prog = progressMap.get(vocab.id) || {
            wordId: vocab.id,
            status: 'new',
            introduced: false,
            seenCount: 0,
            correctCount: 0,
            wrongCount: 0,
            streak: 0,
            lastSeenAt: null,
            nextReviewAt: null,
            mastered: false,
            weak: false
        };

        const item = { vocab, progress: prog };

        if (prog.status === 'new') {
            newPool.push(item);
        } else {
            // Eligible review conditions:
            const isDue = prog.nextReviewAt && prog.nextReviewAt <= now;
            const isWeak = prog.weak === true;
            const isMissed = prog.streak === 0 && prog.seenCount > 0;
            const isLearning = prog.status === 'learning';

            // Mastered or review words not yet due and not weak should be excluded
            const isExcluded = (prog.status === 'mastered' || prog.status === 'review') && !isDue && !isWeak;

            if ((isDue || isWeak || isMissed || isLearning) && !isExcluded) {
                reviewPool.push(item);
            }
        }
    });

    // Shuffle both pools to ensure selection randomness
    shuffleArray(newPool);
    shuffleArray(reviewPool);

    // Target composition: split equally
    const targetNewCount = Math.ceil(batchSize / 2);
    const targetReviewCount = batchSize - targetNewCount;

    let selectedNew = [];
    let selectedReview = [];

    if (reviewPool.length < targetReviewCount) {
        selectedReview = [...reviewPool];
        const extraNeeded = batchSize - selectedReview.length;
        selectedNew = newPool.slice(0, Math.min(extraNeeded, newPool.length));
    } else if (newPool.length < targetNewCount) {
        selectedNew = [...newPool];
        const extraNeeded = batchSize - selectedNew.length;
        selectedReview = reviewPool.slice(0, Math.min(extraNeeded, reviewPool.length));
    } else {
        selectedNew = newPool.slice(0, targetNewCount);
        selectedReview = reviewPool.slice(0, targetReviewCount);
    }

    // Combine and shuffle the final batch
    let batch = [...selectedNew, ...selectedReview];
    shuffleArray(batch);

    // Flatten to standard format containing vocabulary data and attached progress
    let flatBatch = batch.map(item => ({
        ...item.vocab,
        progress: item.progress
    }));

    // Apply de-confliction to prevent consecutive matching letters
    flatBatch = deconflictLetters(flatBatch);

    return flatBatch;
}
