/**
 * Storage and backup helper module for SAT Vocabulary Study App.
 * Handles progress export/import and session state saving/restoring.
 */

import { getAllProgress, saveBulkProgress, resetProgress } from './db.js';

const SESSION_KEY_PREFIX = 'SATVocab_SessionState_';

/**
 * Exports user progress from IndexedDB to a JSON file download.
 * @param {string|null} deck 'nata' | 'sat' | null
 */
export async function exportProgress(deck = null) {
    try {
        const progressList = await getAllProgress(deck);
        const exportData = {
            app: deck === 'nata' ? 'NATA Architecture Vocabulary Study App' : 'SAT Vocabulary Study App',
            deck: deck || 'all',
            version: '2.0.0',
            exportedAt: new Date().toISOString(),
            progress: progressList
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const prefix = deck ? `${deck}-vocab-progress` : 'vocab-progress';
        const a = document.createElement('a');
        a.href = url;
        a.download = `${prefix}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    } catch (error) {
        console.error('Failed to export progress:', error);
        throw error;
    }
}

/**
 * Imports progress from a JSON string into IndexedDB.
 * @param {string} jsonContent 
 */
export async function importProgress(jsonContent) {
    try {
        const data = JSON.parse(jsonContent);
        
        // Simple validation
        if (!data || !Array.isArray(data.progress)) {
            throw new Error('Invalid backup file format.');
        }

        const deck = data.deck && data.deck !== 'all' ? data.deck : null;
        // Reset current deck progress first
        await resetProgress(deck);
        
        // Write the imported progress bulk
        await saveBulkProgress(data.progress);
        return data.progress.length;
    } catch (error) {
        console.error('Failed to import progress:', error);
        throw error;
    }
}

/**
 * Saves the current UI/Session state to localStorage for the active deck.
 * @param {Object} state 
 * @param {string} deck 'nata' | 'sat'
 */
export function saveSessionState(state, deck = 'nata') {
    try {
        localStorage.setItem(`${SESSION_KEY_PREFIX}${deck}`, JSON.stringify(state));
    } catch (e) {
        console.error('Error saving session state:', e);
    }
}

/**
 * Loads the saved session state from localStorage for the active deck.
 * @param {string} deck 'nata' | 'sat'
 * @returns {Object|null}
 */
export function loadSessionState(deck = 'nata') {
    try {
        const item = localStorage.getItem(`${SESSION_KEY_PREFIX}${deck}`);
        if (item) return JSON.parse(item);
        
        // Fallback to legacy single key for backwards compatibility
        const legacy = localStorage.getItem('SATVocab_SessionState');
        return legacy ? JSON.parse(legacy) : null;
    } catch (e) {
        console.error('Error loading session state:', e);
        return null;
    }
}

/**
 * Clears the session state from localStorage for the active deck.
 * @param {string} deck 'nata' | 'sat'
 */
export function clearSessionState(deck = 'nata') {
    try {
        localStorage.removeItem(`${SESSION_KEY_PREFIX}${deck}`);
        localStorage.removeItem('SATVocab_SessionState');
    } catch (e) {
        console.error('Error clearing session state:', e);
    }
}
