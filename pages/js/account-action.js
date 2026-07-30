const runtime = window.__BOROTALK_RUNTIME_CONFIG__ || {};
const API_URL = (runtime.apiUrl || window.location.origin).replace(/\/$/, "");
const mode = document.body.dataset.accountAction;
const form = document.getElementById("actionForm");
const button = document.getElementById("actionButton");
const errorText = document.getElementById("errorText");
const successText = document.getElementById("successText");

function tokenFromFragment() {
    return new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
}

async function request(path, payload) {
    const response = await fetch(`${API_URL}${path}`, {
        method: "POST",
        credentials: "include",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.detail || "Не удалось продолжить");
    return result;
}

async function run(event) {
    event?.preventDefault();
    errorText.textContent = "";
    successText.textContent = "";
    button.disabled = true;
    try {
        if (mode === "verify-email") {
            const token = tokenFromFragment();
            if (!token) throw new Error("В ссылке отсутствует токен подтверждения");
            const result = await request("/auth/email/verify", {token});
            window.history.replaceState(null, "", window.location.pathname);
            successText.textContent = result.status === "approved"
                ? "Email подтверждён, аккаунт активирован. Теперь можно войти."
                : "Email подтверждён. Заявка отправлена владельцу Borotalk.";
        } else if (mode === "forgot-password") {
            await request("/auth/password/forgot", {
                email: document.getElementById("email").value.trim(),
            });
            successText.textContent = "Если аккаунт существует, письмо уже поставлено в очередь.";
            form.reset();
        } else if (mode === "reset-password") {
            const password = document.getElementById("password").value;
            if (password !== document.getElementById("passwordRepeat").value) {
                throw new Error("Пароли не совпадают");
            }
            const token = tokenFromFragment();
            if (!token) throw new Error("В ссылке отсутствует токен сброса");
            await request("/auth/password/reset", {token, password});
            window.history.replaceState(null, "", window.location.pathname);
            form.reset();
            successText.textContent = "Пароль изменён. Теперь войдите заново.";
        }
    } catch (error) {
        errorText.textContent = error.message || "Ошибка сети";
    } finally {
        button.disabled = false;
    }
}

if (form) form.addEventListener("submit", run);
else button.addEventListener("click", run);
