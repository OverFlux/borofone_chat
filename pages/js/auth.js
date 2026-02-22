// ==========================================
// API КОНФИГУРАЦИЯ
// ==========================================

// API URL - всегда используем текущий origin чтобы cookies работали
const API_URL = window.location.origin;

// ==========================================
// ОБРАБОТКА ФОРМЫ ВХОДА (с cookies)
// ==========================================

const loginForm = document.getElementById('loginForm');
const errorText = document.getElementById('errorText');

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorText.textContent = '';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();

    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            credentials: 'include',  // ← ВАЖНО! Сохраняет cookies
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (!response.ok) {
            errorText.textContent = data.detail || 'Ошибка входа';
            return;
        }

        // Токены установлены в httpOnly cookies автоматически
        // Перенаправляем на главную страницу
        window.location.href = './main.html';
    } catch (err) {
        errorText.textContent = 'Ошибка сети. Попробуйте позже.';
    }
});
