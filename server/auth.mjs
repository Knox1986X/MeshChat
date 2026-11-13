// Модуль Zero-Knowledge аутентификации, закрытых приглашений и эфемерных TURN-паролей.
// Сервер НИКОГДА не получает пароль и не позволяет перебирать существующие ники (анти-энумерация).

import crypto from 'node:crypto';
import {
  utf8ToBytes,
  fromBase64Url,
  ecdsaVerify,
} from '../shared/crypto/primitives.mjs';
import { verifyPublicIdentity } from '../shared/crypto/x3dh.mjs';
import { assertPublic, PublicError } from './privacy-gate.mjs';

const USERNAME_RE = /^[a-z][a-z0-9_]{2,31}$/;
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

export class AuthService {
  constructor({ storage, privacyGate, env = process.env }) {
    this.storage = storage;
    this.gate = privacyGate;
    this.inviteOnly = env.INVITE_ONLY === '1' || env.INVITE_ONLY === 'true';
    this.turnHost = env.TURN_HOST || '';
    this.turnPort = Number(env.TURN_PORT || 3478);
    this.turnSecret = env.TURN_SECRET || '';
    this.turnTtlSec = 300; // Ровно 5 минут на установку звонка (вместо 12 часов в старом «Нудисте»!)

    this._challenges = new Map(); // nonce -> { username, expiresAt }
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this._challenges.entries()) {
        if (v.expiresAt <= now) this._challenges.delete(k);
      }
    }, 60 * 1000);
    this._cleanupTimer.unref?.();
  }

  /** Шаг 0: выдача Proof-of-Work перед регистрацией или анонимным вопросом */
  requestPow(purpose, reqCtx) {
    this.gate.enforceLimit('pow', reqCtx.clientTag, 45, 60_000);
    return this.gate.issuePowChallenge(purpose === 'ask' ? 'ask' : 'register');
  }

  /** Регистрация нового анонимного аккаунта (без телефона и email) */
  async register(body, reqCtx) {
    this.gate.enforceLimit('reg', reqCtx.clientTag, 15, 3600 * 1000);

    const username = String(body?.username || '').trim().replace(/^@/, '').toLowerCase();
    assertPublic(
      USERNAME_RE.test(username),
      'Username: от 3 до 32 символов (латиница, цифры, _, начинается с буквы)'
    );

    // 1. Проверяем анти-спам решение Proof-of-Work
    this.gate.verifyPowSolution(body?.powChallenge, body?.powNonce, 'register');

    // 2. В закрытом режиме проверяем одноразовый инвайт
    if (this.inviteOnly) {
      assertPublic(this.storage.consumeInvite(body?.inviteCode), 'Требуется действительный код приглашения', 403);
    }

    assertPublic(!this.storage.getUserByUsername(username), 'Это имя пользователя уже занято', 409);

    // 3. Валидируем криптографический бандл X3DH и Zero-Knowledge ключ аутентификации
    const { authPubB64, encryptedAuthKey, publicBundle } = body || {};
    assertPublic(
      typeof authPubB64 === 'string' && encryptedAuthKey?.v === 1 && publicBundle?.identity && publicBundle?.signedPreKey,
      'Отсутствуют обязательные публичные ключи регистрации'
    );

    const userId = publicBundle.identity.userId;
    assertPublic(
      typeof userId === 'string' && /^u_[a-zA-Z0-9_-]{12,36}$/.test(userId),
      'Некорректный формат клиентского идентификатора userId'
    );
    assertPublic(!this.storage.getUserById(userId), 'Идентификатор пользователя уже существует', 409);

    const identityOk = await verifyPublicIdentity(publicBundle.identity);
    assertPublic(identityOk, 'Подпись связки ключей личности (IK_Bind) не прошла проверку');

    const mailboxId = `mb_${crypto.randomBytes(16).toString('base64url')}`;
    const mailboxWriteToken = crypto.randomBytes(24).toString('base64url');

    const user = this.storage.createUser({
      id: userId,
      username,
      authPubB64,
      encryptedAuthKey,
      publicBundle,
      mailboxId,
      mailboxWriteToken,
      encryptedRecovery: body.encryptedRecovery || null,
    });

    const session = this.storage.createSession(user.id);
    return {
      userId: user.id,
      username: user.username,
      mailboxId: user.mailboxId,
      mailboxWriteToken: user.mailboxWriteToken,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Шаг 1 входа: выдаёт одноразовый challengeNonce и зашифрованный ключом пароля конверт encryptedAuthKey.
   * Если аккаунта не существует — синтезирует правдоподобный детерминированный конверт,
   * чтобы злоумышленник не мог узнать, занят ли никнейм!
   */
  issueLoginChallenge(body, reqCtx) {
    const username = String(body?.username || '').trim().replace(/^@/, '').toLowerCase();
    assertPublic(USERNAME_RE.test(username), 'Некорректный формат имени пользователя');

    this.gate.enforceLimit('challenge-ip', reqCtx.clientTag, 40, 10 * 60 * 1000);
    this.gate.enforceLimit('challenge-user', username, 25, 10 * 60 * 1000);

    const challengeNonce = crypto.randomBytes(24).toString('base64url');
    this._challenges.set(challengeNonce, {
      username,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    const user = this.storage.getUserByUsername(username);
    const encryptedAuthKey = user
      ? user.encryptedAuthKey
      : this._buildSyntheticEncryptedAuthKey(username);

    return {
      challengeNonce,
      encryptedAuthKey,
    };
  }

  /** Шаг 2 входа: проверяет ECDSA-P256 подпись challengeNonce без передачи пароля или хеша */
  async verifyLogin(body, reqCtx) {
    const username = String(body?.username || '').trim().replace(/^@/, '').toLowerCase();
    const challengeNonce = String(body?.challengeNonce || '');
    const signatureB64 = String(body?.signatureB64 || '');

    this.gate.enforceLimit('login-ip', reqCtx.clientTag, 20, 10 * 60 * 1000);
    this.gate.enforceLimit('login-pair', `${reqCtx.clientTag}:${username}`, 8, 10 * 60 * 1000);

    const entry = this._challenges.get(challengeNonce);
    this._challenges.delete(challengeNonce); // Одноразовое погашение в любом случае!

    if (!entry || entry.expiresAt <= Date.now() || entry.username !== username) {
      throw new PublicError('Срок действия запроса на вход истёк, повторите попытку', 401);
    }

    const user = this.storage.getUserByUsername(username);
    if (!user) {
      throw new PublicError('Неверное имя пользователя или пароль', 401);
    }

    const message = utf8ToBytes(`MSG-ZK-LOGIN-v1:${username}:${challengeNonce}`);
    let valid = false;
    try {
      valid = await ecdsaVerify(
        fromBase64Url(user.authPubB64),
        message,
        fromBase64Url(signatureB64)
      );
    } catch {
      valid = false;
    }

    if (!valid) {
      throw new PublicError('Неверное имя пользователя или пароль', 401);
    }

    const session = this.storage.createSession(user.id);
    return {
      userId: user.id,
      username: user.username,
      mailboxId: user.mailboxId,
      mailboxWriteToken: user.mailboxWriteToken,
      encryptedRecovery: user.encryptedRecovery || null,
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Выдаёт эфемерные учётные данные coturn сроком ровно на 300 секунд (5 минут).
   * Имя пользователя в TURN обезличено (<exp>:<randomHex>), чтобы логи TURN не связывались с userId!
   */
  issueEphemeralTurnCredentials() {
    const iceServers = [
      // По умолчанию клиенты могут выбрать режим relay-only для скрытия IP от собеседника в звонке
      { urls: ['stun:stun.cloudflare.com:3478'] },
    ];
    if (this.turnHost && this.turnSecret) {
      const expiresAtSec = Math.floor(Date.now() / 1000) + this.turnTtlSec;
      const anonTag = crypto.randomBytes(6).toString('hex');
      const username = `${expiresAtSec}:${anonTag}`;
      const credential = crypto
        .createHmac('sha1', this.turnSecret)
        .update(username)
        .digest('base64');

      iceServers.push({
        urls: [
          `turn:${this.turnHost}:${this.turnPort}?transport=udp`,
          `turn:${this.turnHost}:${this.turnPort}?transport=tcp`,
        ],
        username,
        credential,
      });
    }
    return {
      ttlSec: this.turnTtlSec,
      iceServers,
    };
  }

  _buildSyntheticEncryptedAuthKey(username) {
    const seed = this.storage.meta.serverFakeAuthSeed;
    const iv = crypto.createHmac('sha256', seed).update(`iv:${username}`).digest().subarray(0, 12);
    const ct = crypto.createHmac('sha512', seed).update(`ct1:${username}`).digest();
    const ct2 = crypto.createHmac('sha512', seed).update(`ct2:${username}`).digest();
    const ct3 = crypto.createHmac('sha256', seed).update(`ct3:${username}`).digest().subarray(0, 26);
    return {
      v: 1,
      alg: 'argon2id',
      iv: iv.toString('base64url'),
      ct: Buffer.concat([ct, ct2, ct3]).toString('base64url'),
    };
  }

  destroy() {
    clearInterval(this._cleanupTimer);
    this._challenges.clear();
  }
}
