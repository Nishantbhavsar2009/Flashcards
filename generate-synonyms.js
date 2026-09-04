import fs from 'fs';
import path from 'path';
import { parseVocab } from './src/parser.js';

const vocabPath = './sat.vocab.pdf_extracted.md';
const outputPath = './src/synonyms.json';

// Simple cleaning helpers
function cleanCandidate(cand, word) {
    let c = cand.toLowerCase().trim();
    // Remove leading "to ", "a ", "an ", "the "
    c = c.replace(/^(to|a|an|the)\s+/, '');
    c = c.replace(/[^a-z0-9\s\-’]/g, '').trim();
    
    // Ignore if empty, identical to target word, or too similar
    if (!c || c === word.toLowerCase() || c.includes(word.toLowerCase()) || word.toLowerCase().includes(c)) {
        return null;
    }
    
    // Max 3 words, prefer 1-2 words
    if (c.split(/\s+/).length > 3) {
        return null;
    }
    
    return c;
}

async function fetchFromDatamuse(word, meaning, pos) {
    const cleanWord = word.toLowerCase();
    const cleanMeaning = meaning.replace(/[^a-zA-Z0-9\s]/g, ' ');
    
    const synUrl = `https://api.datamuse.com/words?rel_syn=${encodeURIComponent(cleanWord)}&max=20`;
    const mlUrl = `https://api.datamuse.com/words?ml=${encodeURIComponent(cleanMeaning)}&max=30`;
    
    const matchingPosCandidates = [];
    const otherCandidates = [];
    
    function addCandidate(candWord, tags) {
        const cleaned = cleanCandidate(candWord, word);
        if (!cleaned) return;
        
        if (matchingPosCandidates.includes(cleaned) || otherCandidates.includes(cleaned)) {
            return;
        }
        
        let posMatch = true;
        if (tags) {
            const hasPosTags = tags.some(t => ['n', 'v', 'adj', 'adv'].includes(t));
            if (hasPosTags) {
                posMatch = false;
                if (pos.includes('v.') && tags.includes('v')) posMatch = true;
                if (pos.includes('adj.') && tags.includes('adj')) posMatch = true;
                if (pos.includes('n.') && tags.includes('n')) posMatch = true;
                if (pos.includes('adv.') && tags.includes('adv')) posMatch = true;
            }
        }
        
        if (posMatch) {
            matchingPosCandidates.push(cleaned);
        } else {
            otherCandidates.push(cleaned);
        }
    }
    
    try {
        const synRes = await fetch(synUrl);
        if (synRes.ok) {
            const synData = await synRes.json();
            for (const item of synData) {
                addCandidate(item.word, item.tags);
            }
        }
    } catch (e) {
        console.warn(`Failed to fetch synonyms for ${word}:`, e.message);
    }
    
    try {
        const mlRes = await fetch(mlUrl);
        if (mlRes.ok) {
            const mlData = await mlRes.json();
            for (const item of mlData) {
                addCandidate(item.word, item.tags);
            }
        }
    } catch (e) {
        console.warn(`Failed to fetch meaning-like words for ${word}:`, e.message);
    }
    
    return [...matchingPosCandidates, ...otherCandidates];
}

async function run() {
    console.log('Reading and parsing vocabulary...');
    const text = fs.readFileSync(vocabPath, 'utf8');
    const words = parseVocab(text);
    console.log(`Parsed ${words.length} words from markdown.`);
    
    // Load existing synonyms if file exists to resume/avoid duplicates
    let synonymDb = {};
    if (fs.existsSync(outputPath)) {
        try {
            synonymDb = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
            console.log(`Loaded ${Object.keys(synonymDb).length} existing synonym entries.`);
        } catch (e) {
            console.warn('Could not parse existing synonyms file, starting fresh.');
        }
    }
    
    let processed = 0;
    const CONCURRENCY = 15;
    
    // Filter words that need synonym generation
    const wordsToProcess = words.filter(w => !synonymDb[w.id]);
    console.log(`Need to generate synonyms for ${wordsToProcess.length} words.`);
    
    // Process in batches
    for (let i = 0; i < wordsToProcess.length; i += CONCURRENCY) {
        const batch = wordsToProcess.slice(i, i + CONCURRENCY);
        
        await Promise.all(batch.map(async (w) => {
            const sensesSynonyms = [];
            
            for (let sIdx = 0; sIdx < w.senses.length; sIdx++) {
                const sense = w.senses[sIdx];
                const meaning = sense.meaning;
                
                // 1. Try to extract from comma-separated list in definition
                const parts = meaning.split(',').map(p => p.trim());
                const localCandidates = [];
                
                // If it is list-like (at least two parts, and parts are short)
                if (parts.length >= 2 && parts.every(p => p.split(/\s+/).length <= 3)) {
                    for (const p of parts) {
                        const cleaned = cleanCandidate(p, w.word);
                        if (cleaned && !localCandidates.includes(cleaned)) {
                            localCandidates.push(cleaned);
                        }
                    }
                }
                
                let selectedSynonyms = localCandidates.slice(0, 3);
                
                // 2. Fall back to Datamuse if we don't have at least 2 synonyms
                if (selectedSynonyms.length < 2) {
                    const apiCandidates = await fetchFromDatamuse(w.word, meaning, w.partOfSpeech);
                    
                    // Merge local and api, keeping local first
                    const allCandidates = [...selectedSynonyms];
                    for (const cand of apiCandidates) {
                        if (!allCandidates.includes(cand)) {
                            allCandidates.push(cand);
                        }
                    }
                    selectedSynonyms = allCandidates.slice(0, 3);
                }
                
                sensesSynonyms.push(selectedSynonyms);
            }
            
            synonymDb[w.id] = sensesSynonyms;
        }));
        
        processed += batch.length;
        console.log(`Processed ${processed} / ${wordsToProcess.length} words...`);
        
        // Periodic autosave
        fs.writeFileSync(outputPath, JSON.stringify(synonymDb, null, 2), 'utf8');
        
        // Small throttle
        await new Promise(r => setTimeout(r, 100));
    }
    
    // Final save
    fs.writeFileSync(outputPath, JSON.stringify(synonymDb, null, 2), 'utf8');
    console.log(`Success! Saved ${Object.keys(synonymDb).length} synonym entries to ${outputPath}.`);
}

run().catch(console.error);
