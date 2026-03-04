/**
 * Wordle Game Integration - Discord-like
 */

// State
let wordleState = {
    game: null,
    stats: null,
    currentGuess: '',
    language: 'ru',
    isLoading: false,
    keyStates: {}, // Track keyboard letter states
};

// Russian keyboard layout
const RUSSIAN_KEYBOARD = [
    ['Й', 'Ц', 'У', 'К', 'Е', 'Н', 'Г', 'Ш', 'Щ', 'З', 'Х', 'Ъ'],
    ['Ф', 'Ы', 'В', 'А', 'П', 'Р', 'О', 'Л', 'Д', 'Ж', 'Э'],
    ['ENTER', 'Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', '⌫']
];

// English keyboard layout
const ENGLISH_KEYBOARD = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫']
];

// DOM Elements
let wordleModal = null;
let wordleBoard = null;
let wordleKeyboard = null;
let wordleStatus = null;

/**
 * Initialize Wordle UI elements
 */
function initWordle() {
    // Create modal if not exists
    if (!document.getElementById('wordleModal')) {
        createWordleModal();
    }
    
    wordleModal = document.getElementById('wordleModal');
    wordleBoard = document.getElementById('wordleBoard');
    wordleKeyboard = document.getElementById('wordleKeyboard');
    wordleStatus = document.getElementById('wordleStatus');
    
    // Add Wordle button to header
    addWordleButton();
    
    // Event listeners
    document.addEventListener('keydown', handleWordleKeydown);
}

/**
 * Create Wordle modal HTML
 */
function createWordleModal() {
    const modal = document.createElement('div');
    modal.id = 'wordleModal';
    modal.className = 'wordle-modal';
    modal.innerHTML = `
        <div class="wordle-content">
            <div class="wordle-header">
                <h2 class="wordle-title">
                    <span class="wordle-icon"></span>
                    Wordle
                </h2>
                <button class="wordle-close" onclick="closeWordleModal()">&times;</button>
            </div>
            
            <div class="wordle-language-toggle">
                <button class="wordle-lang-btn active" data-lang="ru" onclick="setWordleLanguage('ru')">RU</button>
                <button class="wordle-lang-btn" data-lang="en" onclick="setWordleLanguage('en')">EN</button>
            </div>
            
            <div class="wordle-board" id="wordleBoard"></div>
            
            <div class="wordle-status" id="wordleStatus">
                <span class="wordle-status-text">Угадайте слово из 5 букв</span>
            </div>
            
            <div class="wordle-keyboard" id="wordleKeyboard"></div>
            
            <div class="wordle-stats" id="wordleStatsSection" style="display: none;">
                <h3 class="wordle-stats-title">Статистика</h3>
                <div class="wordle-stats-grid" id="wordleStatsGrid"></div>
                <div class="wordle-distribution" id="wordleDistribution"></div>
            </div>
            
            <div class="wordle-actions" id="wordleActions" style="display: none;">
                <button class="wordle-action-btn secondary" onclick="shareWordleResult()">
                    📋 Поделиться
                </button>
                <button class="wordle-action-btn primary" onclick="closeWordleModal()">
                    Закрыть
                </button>
            </div>
            
            <div class="wordle-timer" id="wordleTimer"></div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeWordleModal();
        }
    });
}

/**
 * Add Wordle button to chat header
 */
function addWordleButton() {
    // Wordle button is now handled through the sidebar activities tab
    // This function is kept for backwards compatibility but does nothing
    return;
}

/**
 * Open Wordle modal
 */
async function openWordleModal() {
    if (!wordleModal) initWordle();
    
    wordleModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Load game state
    await loadWordleGame();
    await loadWordleStats();
    
    renderBoard();
    renderKeyboard();
    updateStatsDisplay();
}

/**
 * Close Wordle modal
 */
function closeWordleModal() {
    if (wordleModal) {
        wordleModal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

/**
 * Set Wordle language
 */
async function setWordleLanguage(lang) {
    wordleState.language = lang;
    wordleState.currentGuess = '';
    wordleState.keyStates = {};
    
    // Update UI
    document.querySelectorAll('.wordle-lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    
    // Reload game for new language
    await loadWordleGame();
    await loadWordleStats();
    
    renderBoard();
    renderKeyboard();
    updateStatsDisplay();
    
    // Update status text
    const statusText = document.querySelector('.wordle-status-text');
    if (statusText && !wordleState.game?.guesses?.length) {
        statusText.textContent = lang === 'ru' ? 'Угадайте слово из 5 букв' : 'Guess the 5-letter word';
    }
}

/**
 * Load game state from API
 */
async function loadWordleGame() {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/wordle/game?language=${wordleState.language}`);
        
        if (response.ok) {
            const data = await response.json();
            wordleState.game = data.game;
            updateKeyStates();
        }
    } catch (error) {
        console.error('Failed to load Wordle game:', error);
    }
}

/**
 * Load stats from API
 */
async function loadWordleStats() {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/wordle/stats?language=${wordleState.language}`);
        
        if (response.ok) {
            const data = await response.json();
            wordleState.stats = data.stats;
        }
    } catch (error) {
        console.error('Failed to load Wordle stats:', error);
    }
}

/**
 * Update keyboard key states based on guesses
 */
function updateKeyStates() {
    wordleState.keyStates = {};
    
    if (!wordleState.game?.guesses) return;
    
    for (const guess of wordleState.game.guesses) {
        for (let i = 0; i < guess.word.length; i++) {
            const letter = guess.word[i];
            const result = guess.result[i];
            
            // Priority: correct > present > absent
            const currentState = wordleState.keyStates[letter];
            if (result === 'correct') {
                wordleState.keyStates[letter] = 'correct';
            } else if (result === 'present' && currentState !== 'correct') {
                wordleState.keyStates[letter] = 'present';
            } else if (!currentState) {
                wordleState.keyStates[letter] = 'absent';
            }
        }
    }
}

/**
 * Render the game board
 */
function renderBoard() {
    if (!wordleBoard) return;
    
    wordleBoard.innerHTML = '';
    
    for (let row = 0; row < 6; row++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'wordle-row';
        rowEl.dataset.row = row;
        
        for (let col = 0; col < 5; col++) {
            const cell = document.createElement('div');
            cell.className = 'wordle-cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            
            // Fill in existing guesses - but don't add result classes here
            // Result classes will be added separately with animation
            if (wordleState.game?.guesses?.[row]) {
                const guess = wordleState.game.guesses[row];
                cell.textContent = guess.word[col] || '';
                // Don't add result classes here to avoid re-triggering animations
            } else if (row === (wordleState.game?.guesses?.length || 0)) {
                // Current row - show current guess
                cell.textContent = wordleState.currentGuess[col] || '';
                if (wordleState.currentGuess[col]) {
                    cell.classList.add('filled');
                }
            }
            
            rowEl.appendChild(cell);
        }
        
        wordleBoard.appendChild(rowEl);
    }
    
    // Apply result classes to already-guessed rows (without animation)
    applyResultClasses();
}

/**
 * Apply result classes to all guessed rows (for already completed guesses)
 * Skip the most recent guess as it's handled by animateReveal
 */
function applyResultClasses() {
    if (!wordleBoard || !wordleState.game?.guesses) return;
    
    // Apply to all guesses except the last one (which is handled by animateReveal)
    const guessesToApply = wordleState.game.guesses.slice(0, -1);
    
    guessesToApply.forEach((guess, rowIndex) => {
        const rowEl = wordleBoard.querySelector(`.wordle-row[data-row="${rowIndex}"]`);
        if (!rowEl) return;
        
        const cells = rowEl.querySelectorAll('.wordle-cell');
        guess.result.forEach((result, colIndex) => {
            if (cells[colIndex]) {
                cells[colIndex].classList.add(result, 'already-revealed');
            }
        });
    });
    
    // Also add already-revealed to the last guess (the one that was just animated)
    // since it was cleared when renderBoard rebuilt the board
    const lastGuessIndex = wordleState.game.guesses.length - 1;
    if (lastGuessIndex >= 0) {
        const lastRowEl = wordleBoard.querySelector(`.wordle-row[data-row="${lastGuessIndex}"]`);
        if (lastRowEl) {
            const lastGuess = wordleState.game.guesses[lastGuessIndex];
            const cells = lastRowEl.querySelectorAll('.wordle-cell');
            lastGuess.result.forEach((result, colIndex) => {
                if (cells[colIndex]) {
                    cells[colIndex].classList.add(result, 'already-revealed');
                }
            });
        }
    }
}

/**
 * Render the keyboard
 */
function renderKeyboard() {
    if (!wordleKeyboard) return;
    
    const layout = wordleState.language === 'ru' ? RUSSIAN_KEYBOARD : ENGLISH_KEYBOARD;
    
    wordleKeyboard.innerHTML = '';
    
    for (const row of layout) {
        const rowEl = document.createElement('div');
        rowEl.className = 'wordle-keyboard-row';
        
        for (const key of row) {
            const keyEl = document.createElement('button');
            keyEl.className = 'wordle-key';
            keyEl.textContent = key;
            
            if (key === 'ENTER' || key === '⌫') {
                keyEl.classList.add('wide');
            }
            
            // Apply state
            const letter = key.toUpperCase();
            if (wordleState.keyStates[letter]) {
                keyEl.classList.add(wordleState.keyStates[letter]);
            }
            
            keyEl.onclick = () => handleWordleKeyPress(key);
            
            rowEl.appendChild(keyEl);
        }
        
        wordleKeyboard.appendChild(rowEl);
    }
}

/**
 * Handle keyboard input
 */
function handleWordleKeydown(e) {
    if (!wordleModal?.classList.contains('active')) return;
    
    const key = e.key.toUpperCase();
    
    if (e.key === 'Enter') {
        handleWordleKeyPress('ENTER');
    } else if (e.key === 'Backspace') {
        handleWordleKeyPress('⌫');
    } else if (/^[А-ЯЁA-Z]$/.test(key)) {
        handleWordleKeyPress(key);
    }
}

/**
 * Handle key press
 */
function handleWordleKeyPress(key) {
    if (wordleState.game?.won || wordleState.game?.lost) return;
    if (wordleState.isLoading) return;
    
    const currentRow = wordleState.game?.guesses?.length || 0;
    if (currentRow >= 6) return;
    
    if (key === 'ENTER') {
        submitGuess();
    } else if (key === '⌫') {
        wordleState.currentGuess = wordleState.currentGuess.slice(0, -1);
        renderBoard();
    } else if (wordleState.currentGuess.length < 5) {
        // Validate letter matches language
        const isRussianLetter = /^[А-ЯЁ]$/.test(key);
        const isEnglishLetter = /^[A-Z]$/.test(key);
        
        if ((wordleState.language === 'ru' && isRussianLetter) ||
            (wordleState.language === 'en' && isEnglishLetter)) {
            wordleState.currentGuess += key;
            renderBoard();
        }
    }
}

/**
 * Submit current guess
 */
async function submitGuess() {
    if (wordleState.currentGuess.length !== 5) {
        showWordleStatus('Введите 5 букв', 'error');
        shakeCurrentRow();
        return;
    }
    
    wordleState.isLoading = true;
    
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/wordle/guess`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                guess: wordleState.currentGuess,
                language: wordleState.language
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.is_new_guess) {
                wordleState.game = data.game;
                wordleState.currentGuess = '';
                updateKeyStates();
                
                // Animate reveal with stagger
                await animateReveal();
                
                renderBoard();
                renderKeyboard();
                
                if (data.game.won) {
                    showWordleStatus('🎉 Поздравляем! Вы угадали!', 'win');
                    await showGameEnd();
                } else if (data.game.lost) {
                    const word = data.game.word;
                    showWordleStatus(`Игра окончена. Слово: ${word}`, 'lose');
                    await showGameEnd();
                }
            } else {
                showWordleStatus('Это слово уже было', 'error');
            }
        } else {
            const error = await response.json();
            showWordleStatus(error.detail || 'Ошибка', 'error');
            shakeCurrentRow();
        }
    } catch (error) {
        console.error('Failed to submit guess:', error);
        showWordleStatus('Ошибка соединения', 'error');
    }
    
    wordleState.isLoading = false;
}

/**
 * Show status message
 */
function showWordleStatus(message, type = '') {
    if (!wordleStatus) return;
    
    wordleStatus.innerHTML = `<span class="wordle-status-text ${type}">${message}</span>`;
}

/**
 * Shake current row animation
 */
function shakeCurrentRow() {
    const currentRow = wordleState.game?.guesses?.length || 0;
    const rowEl = document.querySelector(`.wordle-row[data-row="${currentRow}"]`);
    if (rowEl) {
        rowEl.classList.add('shake');
        setTimeout(() => rowEl.classList.remove('shake'), 500);
    }
}

/**
 * Animate reveal of guessed letters with stagger
 */
async function animateReveal() {
    const currentRow = wordleState.game?.guesses?.length - 1;
    if (currentRow < 0) return;
    
    const rowEl = document.querySelector(`.wordle-row[data-row="${currentRow}"]`);
    if (!rowEl) return;
    
    const cells = rowEl.querySelectorAll('.wordle-cell');
    const guess = wordleState.game.guesses[currentRow];
    
    // Add delay before starting reveal
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Reveal each cell with stagger
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const result = guess.result[i];
        
        // Add the result class which triggers the flip animation
        cell.classList.add(result);
        
        // Wait before revealing next cell (stagger effect)
        await new Promise(resolve => setTimeout(resolve, 300));
    }
}

/**
 * Show game end UI
 */
async function showGameEnd() {
    await loadWordleStats();
    updateStatsDisplay();
    
    // Show actions
    const actions = document.getElementById('wordleActions');
    if (actions) actions.style.display = 'flex';
    
    // Update button state
    const wordleBtn = document.getElementById('wordleBtn');
    if (wordleBtn) wordleBtn.classList.add('has-played');
}

/**
 * Update stats display
 */
function updateStatsDisplay() {
    const statsSection = document.getElementById('wordleStatsSection');
    const statsGrid = document.getElementById('wordleStatsGrid');
    const distribution = document.getElementById('wordleDistribution');
    
    if (!wordleState.stats || !statsSection) return;
    
    statsSection.style.display = 'block';
    
    // Stats grid
    const stats = wordleState.stats;
    statsGrid.innerHTML = `
        <div class="wordle-stat-item">
            <div class="wordle-stat-value">${stats.played}</div>
            <div class="wordle-stat-label">Игр</div>
        </div>
        <div class="wordle-stat-item">
            <div class="wordle-stat-value">${stats.win_percentage}</div>
            <div class="wordle-stat-label">Побед %</div>
        </div>
        <div class="wordle-stat-item">
            <div class="wordle-stat-value">${stats.current_streak}</div>
            <div class="wordle-stat-label">Серия</div>
        </div>
        <div class="wordle-stat-item">
            <div class="wordle-stat-value">${stats.max_streak}</div>
            <div class="wordle-stat-label">Макс</div>
        </div>
    `;
    
    // Distribution
    const maxCount = Math.max(...Object.values(stats.guess_distribution || {}), 1);
    const currentGuesses = wordleState.game?.guesses?.length;
    
    distribution.innerHTML = `
        <div class="wordle-distribution-title">Распределение попыток</div>
        ${[1, 2, 3, 4, 5, 6].map(i => {
            const count = stats.guess_distribution?.[i] || 0;
            const width = Math.max((count / maxCount) * 100, 8);
            const isHighlight = wordleState.game?.won && currentGuesses === i;
            return `
                <div class="wordle-distribution-row">
                    <span class="wordle-distribution-label">${i}</span>
                    <div class="wordle-distribution-bar ${isHighlight ? 'highlight' : ''}" style="width: ${width}%">
                        ${count}
                    </div>
                </div>
            `;
        }).join('')}
    `;
}

/**
 * Share Wordle result
 */
async function shareWordleResult() {
    try {
        const response = await fetchWithAuth(`${getApiUrl()}/wordle/share`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                language: wordleState.language
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Copy to clipboard
            await navigator.clipboard.writeText(data.share_text);
            showWordleToast('Скопировано в буфер обмена!');
            
            // Also send to current room if available
            if (currentRoom && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'message',
                    room_id: currentRoom.id,
                    body: data.share_text
                }));
            }
        }
    } catch (error) {
        console.error('Failed to share:', error);
        showWordleToast('Ошибка при копировании');
    }
}

/**
 * Show toast notification
 */
function showWordleToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.wordle-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'wordle-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after delay
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initWordle);

