// Внешний клиент шлюза зашифрованных обращений (/q/<username>).
// Загружает публичный ключ получателя, вычисляет анти-спам задачу Proof-of-Work и шифрует текст
// локально в браузере отправителя (ECDH P-256 + HKDF + AES-256-GCM) до передачи на узел.

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
      .catch(() => setError('Ошибка соединения с узлом ретрансляции'));
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
      if (!res.ok || out.error) throw new Error(out.error || 'Не удалось доставить пакет');
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
      <h2 style="margin-top:0">Шлюз недоступен</h2>
      <p class="modal-desc">${error}</p>
      <a class="btn-primary" href="/">Открыть MeshChat</a>
    </div>`;
  }

  if (!info) {
    return html`<div class="boot-loader"><div class="spinner"></div><span>Верификация ключа @${targetUsername}…</span></div>`;
  }

  return html`<form onSubmit=${submit} class="auth-form">
    <h2 style="margin:0 0 4px;font-size:18px">Зашифрованное обращение к @${info.username}</h2>
    <p class="modal-desc">
      Регистрация не требуется. Сообщение шифруется локально публичным ключом ECDH P-256
      (<code>${info.ikDhPub.slice(0, 16)}…</code>). Узел принимает только шифртекст и не сохраняет IP-адрес.
    </p>

    ${sent && html`<div class="recovery-box">Пакет зашифрован и помещён в слепой почтовый ящик получателя.</div>`}
    ${error && html`<div class="auth-error">${error}</div>`}

    <input
      class="field-input"
      type="text"
      maxLength="1000"
      placeholder="Текст зашифрованного обращения…"
      value=${text}
      onInput=${(e) => { setSent(false); setText(e.target.value); }}
    />

    <button type="submit" class="btn-primary full" disabled=${sending || text.trim().length < 2}>
      ${sending ? 'Шифрование E2E + Proof-of-Work…' : 'Зашифровать и отправить'}
    </button>
  </form>`;
}

render(html`<${AskPage} />`, document.getElementById('ask-root'));
