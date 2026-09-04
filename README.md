# 📚 SAT Vocab - Spaced Repetition Flashcards & Quiz Engine

A modern, fast, and mobile-friendly web application designed to help students master **900+ high-frequency SAT vocabulary words** through scientific spaced repetition (SRS), interactive flashcards, and an adaptive MCQ quiz engine.

![SAT Vocab Preview](public/favicon.svg)

---

## ✨ Features

- **🎴 Smart Flashcards**:
  - Mechanical 3D card flips with pronunciations, parts of speech, comprehensive definitions, real-world examples, and synonyms.
  - **Mobile Touch Gestures**: Swipe left for Next, swipe right for Previous, and tap to flip.
  - **Scroll-Safe Reading**: Vertical scrolling on long definitions won't accidentally flip the card.
- **🧠 Spaced Repetition System (SRS)**:
  - Automatically calculates optimal review intervals based on recall speed and accuracy.
  - Prioritizes weak words and recently missed questions to reinforce long-term memory.
- **🎯 MCQ Quiz Engine**:
  - Adaptive 4-choice questions generated with smart distractors matching parts of speech.
  - Instant answer feedback and deep explanation reveals.
  - Supports keyboard shortcuts (`1-4` or `A-D`).
- **📱 Native Mobile Experience**:
  - Works seamlessly on mobile browsers (Safari, Chrome, Edge) and desktops.
  - **Installable PWA**: Add to Home Screen on iOS and Android for a full-screen, app-like experience.
  - Off-canvas slide-out navigation drawer with top bar and thumb-friendly bottom navigation bar.
- **📊 Analytics & Performance**:
  - Real-time study dashboard tracking Mastery Rate, Weak Words, and Due Reviews.
  - Daily study streak counter (🔥) calculated against local calendar days.
- **💾 Local-First & Privacy-Focused**:
  - 100% offline-ready with IndexedDB.
  - Manual JSON backup and restore so study progress can be exported or transferred to another device anytime.

---

## 📲 How to Install on Mobile (Add to Home Screen)

You can install this app directly on your phone without downloading anything from the App Store:

### 🍏 On iPhone / iPad (Safari)
1. Open the app link in **Safari**.
2. Tap the **Share button** (square icon with an arrow pointing up at the bottom).
3. Scroll down and tap **"Add to Home Screen"**.
4. Tap **"Add"** in the top right. The app icon will appear on your home screen and open full-screen!

### 🤖 On Android (Chrome)
1. Open the app link in **Chrome**.
2. Tap the **three dots menu (⋮)** in the top right corner.
3. Tap **"Install app"** or **"Add to Home screen"**.
4. Confirm to install.

---

## ⌨️ Desktop Keyboard Shortcuts

| Shortcut | Action | Mode |
| :--- | :--- | :--- |
| <kbd>Enter</kbd> / <kbd>Space</kbd> | Flip Flashcard / Continue Quiz | Study / Quiz |
| <kbd>→</kbd> (Right Arrow) | Next Card | Study |
| <kbd>←</kbd> (Left Arrow) | Previous Card | Study |
| <kbd>F</kbd> | Mark as **Easy / Correct** | Study |
| <kbd>D</kbd> | Mark as **Learning** | Study |
| <kbd>S</kbd> | Mark as **Hard / Weak** | Study |
| <kbd>W</kbd> | Mark as **Forgot / Wrong** | Study |
| <kbd>1</kbd> - <kbd>4</kbd> or <kbd>A</kbd> - <kbd>D</kbd> | Select MCQ Choice | Quiz |
| <kbd>Esc</kbd> | Close Navigation Drawer | All |

---

## 🛠️ Tech Stack & Local Setup

- **Frontend**: Vanilla JavaScript (ES Modules), Modern CSS3 (`100dvh`, Glassmorphism, CSS Grid)
- **Bundler**: [Vite](https://vitejs.dev/)
- **Storage**: IndexedDB (`idb`) + LocalStorage
- **Data**: 900+ curated SAT vocabulary entries extracted with multi-sense parsing

### Running Locally

```bash
# 1. Clone repository
git clone https://github.com/Nishantbhavsar2009/Flashcards.git
cd Flashcards

# 2. Install dependencies
npm install

# 3. Start development server with network access
npm run dev -- --host

# 4. Build for production
npm run build
```

---

## 📄 License

MIT License. Free for all students preparing for SAT, ACT, and GRE examinations.
