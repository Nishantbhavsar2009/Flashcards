/**
 * Vocabulary Markdown Parser for SAT Vocabulary Study App
 * Handles noise filtering, layout healing, and parsing multiple senses.
 * Incorporates a state machine to correctly group multi-line example sentences.
 */

export function parseVocab(text) {
    const lines = text.split('\n').map(l => l.trim());
    const cleanLines = [];
    
    // Noise filters for PDF-extracted text
    for (let line of lines) {
        if (line.includes('\u000c')) {
            line = line.replace('\u000c', '').trim();
        }
        
        // Skip vertical letters and page numbers
        if (line === 'S' || line === 'A' || line === 'T' || line === 'V' || line === 'o' || line === 'c' || line === 'a' || line === 'b' || line === 'u' || line === 'l' || line === 'r' || line === 'y') {
            continue;
        }
        
        const lower = line.toLowerCase().replace(/\s+/g, '');
        if (lower === 'satvocabulary' || lower === 'vocabularysat') {
            continue;
        }
        
        cleanLines.push(line);
    }
    
    // Group lines into blocks.
    const blocks = [];
    let currentBlock = [];
    
    // Patterns
    const inlinePattern = /^[a-zA-Z\-’\s]+\s+\((v\.|n\.|adj\.|prep\.|adv\.|conj\.)\)/i;
    const posPattern = /^\((v\.|n\.|adj\.|prep\.|adv\.|conj\.)\)$/i;
    const posGeneral = /\((v\.|n\.|adj\.|prep\.|adv\.|conj\.)\)/i;
    const singleWordPattern = /^[a-z\-’]+$/;
    
    // Helper to check if line i is a standalone word
    function isStandaloneWord(i) {
        const line = cleanLines[i];
        if (!singleWordPattern.test(line) || line.length <= 2) {
            return false;
        }
        
        // Check if there is a POS line within 8 lines and no other single lowercase words in between
        for (let offset = 1; offset <= 8; offset++) {
            const nextIdx = i + offset;
            if (nextIdx >= cleanLines.length) break;
            const nextLine = cleanLines[nextIdx];
            if (!nextLine) continue;
            
            if (posPattern.test(nextLine) || posGeneral.test(nextLine)) {
                return true;
            }
            if (singleWordPattern.test(nextLine) && nextLine.length > 2) {
                return false;
            }
        }
        return false;
    }
    
    for (let i = 0; i < cleanLines.length; i++) {
        const line = cleanLines[i];
        if (!line) continue;
        
        // Single letter section headers (A-Z)
        if (line.length === 1 && line >= 'A' && line <= 'Z') {
            continue;
        }
        
        const isInline = inlinePattern.test(line);
        const isStandalone = isStandaloneWord(i);
        
        if (isInline || isStandalone) {
            if (currentBlock.length > 0) {
                blocks.push(currentBlock);
            }
            currentBlock = [line];
        } else {
            if (currentBlock.length > 0) {
                currentBlock.push(line);
            }
        }
    }
    if (currentBlock.length > 0) {
        blocks.push(currentBlock);
    }
    
    const words = [];
    
    for (const block of blocks) {
        const firstLine = block[0];
        let word = '';
        let posList = [];
        let rawContentLines = [];
        
        // Extract word and initial content
        const inlineMatch = firstLine.match(/^([a-zA-Z\-’\s]+)\s+\(((?:v\.|n\.|adj\.|prep\.|adv\.|conj\.)+)\)\s*(.*)/i);
        if (inlineMatch) {
            word = inlineMatch[1].trim();
            posList.push(`(${inlineMatch[2].trim()})`);
            if (inlineMatch[3]) rawContentLines.push(inlineMatch[3]);
            rawContentLines.push(...block.slice(1));
        } else {
            word = firstLine.trim();
            rawContentLines = block.slice(1);
        }
        
        // Extract all POS lines and values from rawContentLines
        const contentLines = [];
        for (const line of rawContentLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            // If it is exactly a POS, collect it and skip
            if (posPattern.test(trimmed)) {
                if (!posList.includes(trimmed)) posList.push(trimmed);
                continue;
            }
            
            // Check if it's a number like "1.", "2."
            if (/^\d+\.$/.test(trimmed)) {
                continue;
            }
            
            contentLines.push(trimmed);
        }
        
        const partOfSpeech = posList.join(' / ');
        
        // Classify content lines into meanings and examples using a hybrid state machine
        const meanings = [];
        const completeExamples = [];
        const startFragments = [];
        const endFragments = [];
        
        let inExample = false;
        let currentExample = "";

        for (const line of contentLines) {
            const hasOpen = line.includes('(');
            const hasClose = line.includes(')');
            
            if (inExample) {
                // If in example state, and we see a new '(' (without a preceding closing paren), 
                // it means the previous one was unclosed/jumbled!
                if (hasOpen && (!hasClose || line.indexOf('(') < line.indexOf(')'))) {
                    if (currentExample) startFragments.push(currentExample);
                    
                    // Start new example with this line
                    const openIdx = line.indexOf('(');
                    const before = line.slice(0, openIdx).trim();
                    const inside = line.slice(openIdx + 1).trim();
                    if (before) meanings.push(before);
                    
                    if (line.includes(')')) {
                        const closeIdx = line.indexOf(')');
                        completeExamples.push(inside.slice(0, inside.indexOf(')')).trim());
                        const after = line.slice(closeIdx + 1).trim();
                        if (after) meanings.push(after);
                        inExample = false;
                        currentExample = "";
                    } else {
                        currentExample = inside;
                    }
                } else if (hasClose) {
                    const closeIdx = line.indexOf(')');
                    const inside = line.slice(0, closeIdx).trim();
                    const after = line.slice(closeIdx + 1).trim();
                    
                    currentExample += " " + inside;
                    completeExamples.push(currentExample.trim());
                    
                    if (after) meanings.push(after);
                    
                    inExample = false;
                    currentExample = "";
                } else {
                    currentExample += " " + line;
                }
            } else {
                if (hasOpen) {
                    const openIdx = line.indexOf('(');
                    const before = line.slice(0, openIdx).trim();
                    
                    if (hasClose && openIdx < line.indexOf(')')) {
                        const closeIdx = line.indexOf(')');
                        const inside = line.slice(openIdx + 1, closeIdx).trim();
                        const after = line.slice(closeIdx + 1).trim();
                        
                        if (before) meanings.push(before);
                        completeExamples.push(inside);
                        if (after) meanings.push(after);
                    } else {
                        const inside = line.slice(openIdx + 1).trim();
                        if (before) meanings.push(before);
                        currentExample = inside;
                        inExample = true;
                    }
                } else if (hasClose) {
                    const closeIdx = line.indexOf(')');
                    const inside = line.slice(0, closeIdx).trim();
                    const after = line.slice(closeIdx + 1).trim();
                    
                    if (inside) endFragments.push(inside);
                    if (after) meanings.push(after);
                } else {
                    meanings.push(line);
                }
            }
        }
        
        if (inExample && currentExample) {
            startFragments.push(currentExample.trim());
        }

        // Pair starts and ends
        const pairedExamples = [];
        const minLen = Math.min(startFragments.length, endFragments.length);
        for (let i = 0; i < minLen; i++) {
            pairedExamples.push((startFragments[i] + ' ' + endFragments[i]).trim());
        }
        
        if (startFragments.length > minLen) {
            for (let i = minLen; i < startFragments.length; i++) {
                pairedExamples.push(startFragments[i]);
            }
        }
        if (endFragments.length > minLen) {
            for (let i = minLen; i < endFragments.length; i++) {
                pairedExamples.push(endFragments[i]);
            }
        }
        
        const allExamples = [...completeExamples, ...pairedExamples];
        
        // Construct senses
        const senses = [];
        const maxSenses = Math.max(meanings.length, allExamples.length);
        
        if (maxSenses > 0) {
            for (let s = 0; s < maxSenses; s++) {
                const meaning = meanings[s] || meanings[meanings.length - 1] || '';
                const example = allExamples[s] || '';
                
                const cleanMeaning = meaning.replace(/\s+/g, ' ').replace(/^[:\-\s\.]+|[:\-\s\.]+$/g, '').trim();
                const cleanExample = example.replace(/\s+/g, ' ').trim();
                
                if (cleanMeaning || cleanExample) {
                    senses.push({
                        meaning: cleanMeaning,
                        example: cleanExample
                    });
                }
            }
        } else {
            senses.push({
                meaning: 'No meaning parsed',
                example: ''
            });
        }
        
        words.push({
            id: word.toLowerCase().replace(/[^a-z0-9]/g, '_'),
            word: word,
            partOfSpeech: partOfSpeech || '(n/a)',
            senses: senses,
            sectionLetter: word.charAt(0).toUpperCase()
        });
    }
    
    return words;
}
