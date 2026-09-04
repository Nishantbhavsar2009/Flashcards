/**
 * Database module for SAT Vocabulary Study App using IndexedDB.
 * Manages vocabulary and user progress.
 */

const DB_NAME = 'SATVocabDB';
const DB_VERSION = 1;

let dbInstance = null;

export function initDb() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create vocabulary store
            if (!db.objectStoreNames.contains('vocabulary')) {
                db.createObjectStore('vocabulary', { keyPath: 'id' });
            }

            // Create progress store
            if (!db.objectStoreNames.contains('progress')) {
                db.createObjectStore('progress', { keyPath: 'wordId' });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            console.error('IndexedDB open error:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Vocabulary Store Operations

export async function getAllVocab() {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('vocabulary', 'readonly');
        const store = transaction.objectStore('vocabulary');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getVocabById(id) {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('vocabulary', 'readonly');
        const store = transaction.objectStore('vocabulary');
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveVocabList(words) {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('vocabulary', 'readwrite');
        const store = transaction.objectStore('vocabulary');

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);

        // Clear existing vocabulary first
        store.clear();

        for (const word of words) {
            store.put(word);
        }
    });
}

// Progress Store Operations

export async function getAllProgress() {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('progress', 'readonly');
        const store = transaction.objectStore('progress');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function getProgressForWord(wordId) {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('progress', 'readonly');
        const store = transaction.objectStore('progress');
        const request = store.get(wordId);

        request.onsuccess = () => {
            if (request.result) {
                resolve(request.result);
            } else {
                // Default progress object
                resolve({
                    wordId,
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
                });
            }
        };
        request.onerror = () => reject(request.error);
    });
}

export async function saveProgress(progress) {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('progress', 'readwrite');
        const store = transaction.objectStore('progress');
        const request = store.put(progress);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveBulkProgress(progressList) {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('progress', 'readwrite');
        const store = transaction.objectStore('progress');

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);

        for (const progress of progressList) {
            store.put(progress);
        }
    });
}

export async function resetProgress() {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('progress', 'readwrite');
        const store = transaction.objectStore('progress');
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function resetAll() {
    const db = await initDb();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['vocabulary', 'progress'], 'readwrite');
        const vocabStore = transaction.objectStore('vocabulary');
        const progressStore = transaction.objectStore('progress');

        vocabStore.clear();
        progressStore.clear();

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
}
