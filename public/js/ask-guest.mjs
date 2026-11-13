// Гостевой скрипт «Голой правды» (/q/<username>).
// Скачивает публичный ключ получателя, решает анти-спам задачу Proof-of-Work и шифрует вопрос
// прямо в браузере гостя (ECDH P-256 + HKDF + AES-256-GCM) перед отправкой на сервер.

import { html, render, useState, useEffect } from '../vendor/preact.mjs';
import { solveProofOfWork } from '../../shared/crypto/kdf.mjs';
import { encryptAnonymousQuestion } from '../../shared/crypto/sealed-sender.mjs';

function AskPage() {
  const targetUsername = decodeURIComponent(location.pathname.replace(/^\/q\//, '')).replace(/^@/, '');
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/ask/${encodeURIComponent(targetUsername)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || d.error) setError(d.error || 'Получатель не найден');
        else setInfo(d);
      })
      .catch(() => setError('Ошибка соединения с узлом'));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!info || sending || text.trim().length < 2) return;
    setSending(true);
    setError('');
    try {
      const pow = await fetch('/api/auth/pow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purpose: 'ask' }),
      }).then((r) => r.json());

      const [powNonce, payloadB64] = await Promise.all([
        solveProofOfWork(pow.challengeToken, pow.difficultyBits),
        encryptAnonymousQuestion({ recipientIkDhPubB64: info.ikDhPub, text }),
      ]);

      const res = await fetch('/api/ask/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mailboxId: info.mailboxId,
          powChallenge: pow.challengeToken,
          powNonce,
          payloadB64,
        }),
      });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error || 'Не удалось доставить вопрос');
      setSent(true);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (error && !info) {
    return html`<div>
      <h2>Ссылка недоступна</h2>
      <p class="modal-desc">${error}</p>
      <a class="btn-primary" href="/">Открыть мессенджер</a>
    </div>`;
  }

  if (!info) {
    return html`<div class="boot-loader"><div class="spinner"></div><span>Проверка ключа @${targetUsername}…</span></div>`;
  }

  return html`<form onSubmit=${submit} class="auth-form">
    <h2>🎭 Анонимный вопрос для @${info.username}</h2>
    <p class="modal-desc">
      Регистрация не нужна. Ваш текст шифруется в этом браузере публичным ключом
      <code>${info.ikDhPub.slice(0, 14)}…</code> — сервер видит только шифртекст и не хранит ваш IP.
    </p>

    ${sent && html`<div class="recovery-box">✓ Зашифрованный вопрос доставлен в слепой ящик получателя!</div>`}
    ${error && html`<div class="auth-error">${error}</div>`}

    <input
      class="field-input"
      type="text"
      maxLength="1000"
      placeholder="Напишите анонимное сообщение…"
      value=${text}
      onInput=${(e) => { setSent(false); setText(e.target.value); }}
    />

    <button type="submit" class="btn-primary full" disabled=${sending || text.trim().length < 2}>
      ${sending ? 'Шифрование E2E + Proof-of-Work…' : 'Зашифровать и отправить анонимно'}
    </button>
  </form>`;
}

render(html`<${AskPage} />`, document.getElementById('ask-root'));
