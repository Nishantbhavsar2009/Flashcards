/**
 * Reusable UI and rendering helpers for SAT Vocabulary Study App.
 * Handles DOM injections, alerts, charts, and table population.
 */

/**
 * Displays a toast alert message on the screen.
 * @param {string} message 
 * @param {string} type 'success' | 'danger' | 'info'
 */
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'danger') icon = '❌';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    // Auto remove toast
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => {
            if (container.contains(toast)) {
                container.removeChild(toast);
            }
        }, 500);
    }, 3000);
}

/**
 * Injects vocabulary senses (meanings & examples) into a target container.
 * @param {HTMLElement} container 
 * @param {Array} senses 
 */
export function renderSensesList(container, senses) {
    if (!container) return;
    container.innerHTML = '';

    senses.forEach((sense, idx) => {
        const senseItem = document.createElement('div');
        senseItem.className = 'sense-item';
        
        let senseNumStr = senses.length > 1 ? `<span class="sense-num">${idx + 1}.</span>` : '';
        
        let synonymsStr = '';
        if (sense.synonyms && sense.synonyms.length > 0) {
            synonymsStr = `<p class="sense-synonyms"><strong>Synonyms:</strong> ${sense.synonyms.join(', ')}</p>`;
        }
        
        let exampleStr = sense.example 
            ? `<p class="sense-example">"${sense.example}"</p>` 
            : '';

        senseItem.innerHTML = `
            <p class="sense-meaning">${senseNumStr}${sense.meaning}</p>
            ${synonymsStr}
            ${exampleStr}
        `;
        container.appendChild(senseItem);
    });
}

/**
 * Updates the Dashboard values and distribution graph.
 * @param {Object} data 
 */
export function updateDashboardStats(data) {
    // Basic labels
    document.getElementById('stat-learned-count').innerHTML = `${data.learnedCount} <small>/ ${data.totalCount}</small>`;
    document.getElementById('stat-mastery-rate').innerText = `${Math.round(data.masteryRate)}%`;
    document.getElementById('stat-weak-count').innerText = data.weakCount;
    document.getElementById('stat-due-count').innerText = data.dueCount;

    // Badges in sidebar and mobile bottom nav
    const revBadge = document.getElementById('review-badge');
    if (revBadge) {
        revBadge.innerText = data.dueCount;
        revBadge.style.display = data.dueCount > 0 ? 'inline-block' : 'none';
    }
    const revBadgeBottom = document.getElementById('review-badge-bottom');
    if (revBadgeBottom) {
        revBadgeBottom.innerText = data.dueCount;
        revBadgeBottom.style.display = data.dueCount > 0 ? 'inline-block' : 'none';
    }

    // Streaks
    const sidebarStreak = document.getElementById('sidebar-streak');
    if (sidebarStreak) sidebarStreak.innerText = data.streak;
    const mobileStreak = document.getElementById('mobile-streak');
    if (mobileStreak) mobileStreak.innerText = data.streak;

    // Bar distribution counts
    document.getElementById('lbl-count-new').innerText = data.dist.new;
    document.getElementById('lbl-count-learning').innerText = data.dist.learning;
    document.getElementById('lbl-count-review').innerText = data.dist.review;
    document.getElementById('lbl-count-mastered').innerText = data.dist.mastered;
    document.getElementById('lbl-count-weak').innerText = data.dist.weak;

    // Set segment widths
    const total = data.totalCount || 1;
    document.getElementById('bar-new').style.width = `${(data.dist.new / total) * 100}%`;
    document.getElementById('bar-learning').style.width = `${(data.dist.learning / total) * 100}%`;
    document.getElementById('bar-review').style.width = `${(data.dist.review / total) * 100}%`;
    document.getElementById('bar-mastered').style.width = `${(data.dist.mastered / total) * 100}%`;
    document.getElementById('bar-weak').style.width = `${(data.dist.weak / total) * 100}%`;
}

/**
 * Render dot indicators for study batches.
 * @param {HTMLElement} container 
 * @param {number} size Total items (usually 10)
 * @param {number} activeIndex Current focused word index
 * @param {Array} results Array of correct/wrong boolean values for session history
 */
export function renderIndicators(container, size, activeIndex, results = []) {
    if (!container) return;
    container.innerHTML = '';

    for (let i = 0; i < size; i++) {
        const dot = document.createElement('span');
        let className = 'indicator-dot';
        if (i === activeIndex) {
            className += ' active';
        }
        
        // Mark as answered correctly or wrongly
        if (results[i] === true) {
            className += ' correct';
        } else if (results[i] === false) {
            className += ' wrong';
        }

        dot.className = className;
        container.appendChild(dot);
    }
}

/**
 * Render lists in Stats screen
 * @param {Array} weakWords List of weak words
 * @param {Array} masteredWords List of mastered words
 * @param {Function} onStudyWeak Callback when user clicks 'Study' on a weak word in the list
 */
export function renderStatsScreen(accuracy, streak, weakWords, masteredWords, onStudyWeak) {
    document.getElementById('stats-accuracy').innerText = `${Math.round(accuracy)}%`;
    document.getElementById('stats-streak').innerText = `${streak} day${streak === 1 ? '' : 's'}`;
    
    document.getElementById('stats-weak-count').innerText = weakWords.length;
    document.getElementById('stats-mastered-count').innerText = masteredWords.length;

    // Populate Weak Words Table
    const weakTbody = document.getElementById('stats-weak-tbody');
    weakTbody.innerHTML = '';
    
    if (weakWords.length === 0) {
        weakTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No weak words! You are crushing it! 🚀</td></tr>`;
    } else {
        weakWords.slice(0, 50).forEach(item => { // Limit to top 50 for performance
            const tr = document.createElement('tr');
            
            // Calculate ratio
            const wrong = item.progress.wrongCount || 0;
            const correct = item.progress.correctCount || 0;
            
            tr.innerHTML = `
                <td><strong>${item.word}</strong></td>
                <td><span class="badge badge-pos">${item.partOfSpeech}</span></td>
                <td><span class="font-red">${wrong}</span> / <span class="font-green">${correct}</span></td>
                <td><button class="btn btn-secondary btn-sm study-word-btn" data-word="${item.word}">Study Now</button></td>
            `;
            weakTbody.appendChild(tr);
        });

        // Attach action events
        weakTbody.querySelectorAll('.study-word-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const word = e.currentTarget.getAttribute('data-word');
                onStudyWeak(word);
            });
        });
    }

    // Populate Mastered Words Table
    const masteredTbody = document.getElementById('stats-mastered-tbody');
    masteredTbody.innerHTML = '';

    if (masteredWords.length === 0) {
        masteredTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No mastered words yet. Complete batches to achieve mastery!</td></tr>`;
    } else {
        masteredWords.slice(0, 50).forEach(item => {
            const tr = document.createElement('tr');
            
            // Format review date
            let nextReviewStr = 'N/A';
            if (item.progress.nextReviewAt) {
                const diffMs = item.progress.nextReviewAt - Date.now();
                if (diffMs <= 0) {
                    nextReviewStr = 'Due now';
                } else {
                    const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
                    nextReviewStr = `in ${days} day${days === 1 ? '' : 's'}`;
                }
            }

            tr.innerHTML = `
                <td><strong>${item.word}</strong></td>
                <td><span class="badge badge-pos">${item.partOfSpeech}</span></td>
                <td>🔥 <span class="font-green">${item.progress.streak}</span></td>
                <td style="color:var(--text-secondary);">${nextReviewStr}</td>
            `;
            masteredTbody.appendChild(tr);
        });
    }
}
