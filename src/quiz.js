/**
 * Quiz module for SAT Vocabulary Study App.
 * Generates MCQs with smart distractor matching.
 */

/**
 * Shuffles an array in place.
 * @param {Array} array 
 * @returns {Array} Shuffled array
 */
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Helper to check if a word has a specific part of speech
 * @param {Object} item Vocab item
 * @param {string} targetPos Target POS inside parentheses, e.g. "(v.)"
 */
function matchesPos(item, targetPos) {
    if (!targetPos || !item.partOfSpeech) return false;
    const cleanTarget = targetPos.replace(/[().]/g, '').trim().toLowerCase();
    const cleanItemPos = item.partOfSpeech.replace(/[().]/g, '').trim().toLowerCase();
    
    // Split by slash and check if any match
    const targetParts = cleanTarget.split(/\s*\/\s*/);
    const itemParts = cleanItemPos.split(/\s*\/\s*/);
    
    return itemParts.some(p => targetParts.includes(p));
}

/**
 * Generates MCQ questions for a study batch.
 * @param {Array} batch 10 words in current study batch
 * @param {Array} fullVocab Full vocabulary list for generating distractors
 * @returns {Array} List of MCQ objects
 */
export function generateQuiz(batch, fullVocab) {
    const questions = [];

    batch.forEach(targetWord => {
        // Decide question type randomly (0: Word -> Definition, 1: Definition -> Word)
        const type = Math.random() < 0.5 ? 'definition' : 'word';
        
        // Pick a random sense from the target word
        const senseIndex = Math.floor(Math.random() * targetWord.senses.length);
        const correctSense = targetWord.senses[senseIndex];
        const correctMeaning = correctSense.meaning;

        // Find potential distractor words (exclude correct word)
        const candidates = fullVocab.filter(w => w.id !== targetWord.id);
        
        // Split candidates into same POS and other POS
        const samePosCandidates = candidates.filter(w => matchesPos(w, targetWord.partOfSpeech));

        // Helper to select 3 distinct items
        function getDistractors(pool, count) {
            const shuffled = shuffle([...pool]);
            const selected = [];
            for (const item of shuffled) {
                if (selected.length >= count) break;
                // Ensure the candidate has senses
                if (item.senses && item.senses.length > 0) {
                    selected.push(item);
                }
            }
            return selected;
        }

        let distractorWords = [];
        if (samePosCandidates.length >= 3) {
            distractorWords = getDistractors(samePosCandidates, 3);
        } else {
            // Mix same POS and others
            const samePosDistractors = getDistractors(samePosCandidates, samePosCandidates.length);
            const needed = 3 - samePosDistractors.length;
            const fallbackPool = candidates.filter(w => !samePosCandidates.includes(w));
            const extraDistractors = getDistractors(fallbackPool, needed);
            distractorWords = [...samePosDistractors, ...extraDistractors];
        }

        // Build choices list
        const choices = [];
        if (type === 'definition') {
            // Question: "What does [word] mean?"
            // Choices are meanings
            choices.push({
                text: correctMeaning,
                isCorrect: true,
                word: targetWord.word
            });
            
            const seenMeanings = new Set([correctMeaning]);
            for (const dw of distractorWords) {
                if (choices.length >= 4) break;
                const validSenses = dw.senses ? dw.senses.filter(s => s.meaning && !seenMeanings.has(s.meaning)) : [];
                if (validSenses.length > 0) {
                    const chosen = validSenses[Math.floor(Math.random() * validSenses.length)];
                    seenMeanings.add(chosen.meaning);
                    choices.push({
                        text: chosen.meaning,
                        isCorrect: false,
                        word: dw.word
                    });
                }
            }

            // Fallback fill if fewer than 4 unique choices
            if (choices.length < 4) {
                for (const cand of shuffle([...candidates])) {
                    if (choices.length >= 4) break;
                    if (cand.senses) {
                        for (const s of cand.senses) {
                            if (s.meaning && !seenMeanings.has(s.meaning)) {
                                seenMeanings.add(s.meaning);
                                choices.push({
                                    text: s.meaning,
                                    isCorrect: false,
                                    word: cand.word
                                });
                                break;
                            }
                        }
                    }
                }
            }
        } else {
            // Question: "Which word matches this definition: [meaning]?"
            // Choices are words
            choices.push({
                text: targetWord.word,
                isCorrect: true,
                partOfSpeech: targetWord.partOfSpeech
            });

            const seenWords = new Set([targetWord.word]);
            for (const dw of distractorWords) {
                if (choices.length >= 4) break;
                if (!seenWords.has(dw.word)) {
                    seenWords.add(dw.word);
                    choices.push({
                        text: dw.word,
                        isCorrect: false,
                        partOfSpeech: dw.partOfSpeech
                    });
                }
            }

            // Fallback fill if fewer than 4 unique choices
            if (choices.length < 4) {
                for (const cand of shuffle([...candidates])) {
                    if (choices.length >= 4) break;
                    if (!seenWords.has(cand.word)) {
                        seenWords.add(cand.word);
                        choices.push({
                            text: cand.word,
                            isCorrect: false,
                            partOfSpeech: cand.partOfSpeech
                        });
                    }
                }
            }
        }

        // Shuffle choices and locate correct index
        const shuffledChoices = shuffle([...choices]);
        const correctIndex = shuffledChoices.findIndex(c => c.isCorrect);

        // Build question text
        let questionText = '';
        if (type === 'definition') {
            questionText = `What is the meaning of the word <strong>"${targetWord.word}"</strong> ${targetWord.partOfSpeech}?`;
        } else {
            questionText = `Which word matches this definition:<br><em class="def-highlight">"${correctMeaning}"</em>?`;
        }

        questions.push({
            wordId: targetWord.id,
            word: targetWord.word,
            partOfSpeech: targetWord.partOfSpeech,
            questionText,
            type,
            choices: shuffledChoices,
            correctIndex,
            correctAnswerText: type === 'definition' ? correctMeaning : targetWord.word,
            exampleSentence: correctSense.example || ''
        });
    });

    return questions;
}
