/**
 * Storage and backup helper module for SAT Vocabulary Study App.
 * Handles progress export/import and session state saving/restoring.
 */

import { getAllProgress, saveBulkProgress, resetProgress } from './db.js';

const SESSION_KEY = 'SATVocab_SessionState';

/**
 * Exports all user progress from IndexedDB to a JSON file download.
 */
export async function exportProgress() {
    try {
        const progressList = await getAllProgress();
        const exportData = {
            app: 'SAT Vocabulary Study App',
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            progress: progressList
        };

        const jsonString = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `sat-vocab-progress-${new Date().toISOString().split('T')[0]}.json`;
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

        // Reset current progress first
        await resetProgress();
        
        // Write the imported progress bulk
        await saveBulkProgress(data.progress);
        return data.progress.length;
    } catch (error) {
        console.error('Failed to import progress:', error);
        throw error;
    }
}

/**
 * Saves the current UI/Session state to localStorage.
 * @param {Object} state 
 */
export function saveSessionState(state) {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('Error saving session state:', e);
    }
}

/**
 * Loads the saved session state from localStorage.
 * @returns {Object|null}
 */
export function loadSessionState() {
    try {
        const item = localStorage.getItem(SESSION_KEY);
        return item ? JSON.parse(item) : null;
    } catch (e) {
        console.error('Error loading session state:', e);
        return null;
    }
}

/**
 * Clears the session state from localStorage.
 */
export function clearSessionState() {
    try {
        localStorage.removeItem(SESSION_KEY);
    } catch (e) {
        console.error('Error clearing session state:', e);
    }
}
