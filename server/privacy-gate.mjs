// Граница приватности сервера (Privacy Gate):
//   1. Мгновенно преобразует сетевой IP в необратимый солёный отпечаток в RAM и отбрасывает сырой IP.
//   2. Ротирует секретную соль каждые 12 часов исключительно в оперативной памяти (на диск не пишется).
//   3. Реализует скользящий rate-limit и stateless Hashcash Proof-of-Work против спама без CAPTCHA и SMS.

import crypto from 'node:crypto';

export class PublicError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'PublicError';
    this.statusCode = statusCode;
  }
}

export function assertPublic(condition, message, statusCode = 400) {
  if (!condition) throw new PublicError(message, statusCode);
}

function countZeroBits(buf) {
  let bits = 0;
  for (const b of buf) {
    if (b === 0) bits += 8;
    else {
      bits += Math.clz32(b) - 24;
      break;
    }
  }
  return bits;
}

export class PrivacyGate {
  constructor({
    saltRotationMs = 12 * 3600 * 1000,
    basePowBits = Number(process.env.POW_BITS || 14),
    trustProxy = process.env.TRUST_PROXY === '1' || Boolean(process.env.RENDER || process.env.FLY_APP_NAME),
  } = {}) {
    this.trustProxy = trustProxy;
    this.basePowBits = basePowBits;
    this._currentSalt = crypto.randomBytes(32);
    this._prevSalt = crypto.randomBytes(32);
    this._powSecret = crypto.randomBytes(32);
    this._buckets = new Map(); // bucketKey -> number[]
    this._recentRegs = [];     // timestamps для адаптивной сложности PoW

    this._rotateTimer = setInterval(() => {
      this._prevSalt.fill(0);
      this._prevSalt = this._currentSalt;
      this._currentSalt = crypto.randomBytes(32);
    }, saltRotationMs);
    this._rotateTimer.unref?.();

    this._gcTimer = setInterval(() => this._cleanupBuckets(), 5 * 60 * 1000);
    this._gcTimer.unref?.();
  }

  /**
   * Извлекает контекст запроса БЕЗ сохранения реального IP.
   * Возвращает только короткий RAM-отпечаток `clientTag` и признак анонимной сети (Tor/I2P).
   */
  inspectRequest(req) {
    const headers = req.headers || {};
    let rawAddr = req.socket?.remoteAddress || '0.0.0.0';

    if (this.trustProxy) {
      const cfIp = headers['cf-connecting-ip'] || headers['fly-client-ip'];
      const xff = typeof headers['x-forwarded-for'] === 'string'
        ? headers['x-forwarded-for'].split(',')[0].trim()
        : '';
      rawAddr = String(cfIp || xff || rawAddr);
    }
    rawAddr = rawAddr.replace(/^::ffff:/, '');

    const hostHeader = String(headers.host || '').toLowerCase();
    const isOnion = hostHeader.endsWith('.onion') || headers['x-veil-transport'] === 'tor';
    const isI2p = hostHeader.endsWith('.i2p') || headers['x-veil-transport'] === 'i2p';
    const isLoopback = rawAddr === '127.0.0.1' || rawAddr === '::1';

    // Для локального демона Tor/I2P все коннекты приходят с 127.0.0.1 —
    // чтобы один спамер в Tor не заблокировал всех остальных пользователей Tor по общему IP 127.0.0.1,
    // смешиваем адрес с сокетом при чтении, а защиту от ботов делегируем Proof-of-Work.
    const rateSource = (isLoopback && (isOnion || isI2p))
      ? `anon:${req.socket?.remotePort || 0}`
      : rawAddr;

    const clientTag = crypto
      .createHmac('sha256', this._currentSalt)
      .update(rateSource)
      .digest('base64url')
      .slice(0, 16);

    // Вычисляем функцию для персонального солёного отпечатка «Голой правды» (без утечки rawAddr наружу)
    const computeRecipientSenderTag = (recipientAskSalt) =>
      crypto
        .createHmac('sha256', String(recipientAskSalt))
        .update(rawAddr)
        .digest('base64url')
        .slice(0, 20);

    // Немедленно затираем локальную переменную rawAddr в замыкании не оставляем?
    // Пересчитаем промежуточный ключ один раз, чтобы строка rawAddr вообще не удерживалась в памяти!
    const blindIpDigest = crypto.createHmac('sha256', this._currentSalt).update(rawAddr).digest();
    rawAddr = '';

    return Object.freeze({
      clientTag,
      networkKind: isOnion ? 'tor' : isI2p ? 'i2p' : 'clearnet',
      deriveSenderBlockTag: (recipientAskSalt) =>
        crypto
          .createHmac('sha256', String(recipientAskSalt))
          .update(blindIpDigest)
          .digest('base64url')
          .slice(0, 20),
    });
  }

  /** Проверка лимита частоты запросов по обезличенному ключу */
  enforceLimit(scope, key, maxHits, windowMs) {
    const now = Date.now();
    const fullKey = `${scope}:${key}`;
    const cutoff = now - windowMs;
    const prev = this._buckets.get(fullKey);
    const active = prev ? prev.filter((t) => t > cutoff) : [];

    if (active.length >= maxHits) {
      throw new PublicError('Превышен лимит запросов. Подождите немного и повторите попытку.', 429);
    }
    active.push(now);
    this._buckets.set(fullKey, active);
  }

  /** Выдаёт подписанную сервером stateless задачу Proof-of-Work (с адаптивной сложностью при атаке) */
  issuePowChallenge(purpose = 'register') {
    const now = Date.now();
    this._recentRegs = this._recentRegs.filter((t) => t > now - 60_000);
    // При всплеске >30 регистраций в минуту плавно поднимаем сложность на 2..4 бита
    const surgeExtra = this._recentRegs.length > 100 ? 4 : this._recentRegs.length > 30 ? 2 : 0;
    const difficultyBits = Math.min(20, this.basePowBits + surgeExtra);

    const exp = now + 5 * 60 * 1000;
    const rand = crypto.randomBytes(12).toString('base64url');
    const payload = `${purpose}.${difficultyBits}.${exp}.${rand}`;
    const sig = crypto.createHmac('sha256', this._powSecret).update(payload).digest('base64url');
    return {
      challengeToken: `${payload}.${sig}`,
      difficultyBits,
      expiresAt: exp,
    };
  }

  /** Проверяет решение Proof-of-Work без хранения состояния в БД (кроме одноразового погашения) */
  verifyPowSolution(challengeToken, nonce, expectedPurpose = 'register') {
    assertPublic(
      typeof challengeToken === 'string' && typeof nonce === 'string' && nonce.length <= 32,
      'Отсутствует решение анти-спам задачи Proof-of-Work'
    );
    const parts = challengeToken.split('.');
    assertPublic(parts.length === 5, 'Некорректный формат токена Proof-of-Work');

    const [purpose, diffStr, expStr, rand, sig] = parts;
    assertPublic(purpose === expectedPurpose, 'Несовпадение назначения токена Proof-of-Work');

    const exp = Number(expStr);
    const difficultyBits = Number(diffStr);
    assertPublic(Number.isFinite(exp) && exp > Date.now(), 'Срок действия задачи Proof-of-Work истёк');

    const payload = `${purpose}.${diffStr}.${expStr}.${rand}`;
    const expectedSig = crypto.createHmac('sha256', this._powSecret).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    assertPublic(a.length === b.length && crypto.timingSafeEqual(a, b), 'Подпись задачи Proof-of-Work недействительна');

    // Защита от повторного использования одного и того же решения
    this.enforceLimit('pow-used', rand, 1, 6 * 60 * 1000);

    const digest = crypto.createHash('sha256').update(`MSG-POW-v1:${challengeToken}:${nonce}`).digest();
    assertPublic(
      countZeroBits(digest) >= difficultyBits,
      'Недостаточная сложность решения Proof-of-Work'
    );

    if (expectedPurpose === 'register') {
      this._recentRegs.push(Date.now());
    }
    return true;
  }

  _cleanupBuckets() {
    const cutoff = Date.now() - 3600 * 1000;
    for (const [k, arr] of this._buckets.entries()) {
      if (!arr.length || arr[arr.length - 1] < cutoff) {
        this._buckets.delete(k);
      }
    }
  }

  destroy() {
    clearInterval(this._rotateTimer);
    clearInterval(this._gcTimer);
    this._currentSalt.fill(0);
    this._prevSalt.fill(0);
    this._powSecret.fill(0);
    this._buckets.clear();
  }
}
