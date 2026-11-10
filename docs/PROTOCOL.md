# Протокол MeshChat v1

Всё, что нужно, чтобы написать совместимый клиент. Обозначения: `b64u` —
base64url без паддинга, `u32` — big-endian 32 бита.

## 1. Идентичность

```
seed32        = random
edPub, edSec  = Ed25519_from_seed(seed32)          // crypto_sign_seed_keypair
xPub, xSec    = Ed25519_to_Curve25519(edPub, edSec)
address       = b64u(edPub)                        // 43 символа
tag           = b64u(BLAKE2b-256("meshchat/routing-tag/v1" || edPub)[0..16])
```

`tag` (22 символа) — единственный идентификатор, который видит сервер.
Safety number: `BLAKE2b-256("meshchat/safety-number/v1" || edPub)` → 60 цифр,
сгруппированных по 5.

### Приглашение

```
meshchat://add?v=1&k=<edPub>&n=<name>&r=<relay1,relay2>&a=<about>
https://<host>/#/add?v=1&k=…        // веб-вариант, тот же query
```

## 2. Prekeys (X3DH)

Публикуются под своим `tag`:

```jsonc
{
  "bundle": { "v": 1, "ik": "…", "spk": "…", "spkId": 7, "spkSig": "…", "ts": 1730000000000 },
  "opks":   [ { "id": 8, "pub": "…" }, … ]        // до 300
}

spkSig = Ed25519_sign( "meshchat/signed-prekey/v1" || spk_pub || u16le(spkId) , edSec )
```

Проверка: подпись валидна ключом `ik`, и `ik` совпадает с ключом из приглашения.
Иначе — отказ (relay не может подменить ключи).

Сервер при `GET /v1/keys/:tag` возвращает `bundle` вместе с **одним** `opk`,
который больше не выдаётся (one-time).

## 3. Согласование ключа (X3DH)

```
DH1 = DH(IK_A_sec, SPK_B)
DH2 = DH(EK_A_sec, IK_B_x)
DH3 = DH(EK_A_sec, SPK_B)
DH4 = DH(EK_A_sec, OPK_B)            // если OPK есть
F   = IK_A_x || IK_B_x
SK  = HKDF-SHA256(ikm = F||DH1||DH2||DH3||DH4,
                  salt = "meshchat/x3dh/v1", info = "meshchat/session/v1", 32)
```

Инициатор отправляет `ek = EK_A_pub`, `opk = id`, `spk = id` и свой `ik` в первом
конверте (kind `p`). Ответчик находит секреты по id и считает те же DH.

## 4. Double Ratchet

### KDF

```
KDF_RK(rk, dh) = HKDF-SHA256(dh, salt=rk, info="meshchat/ratchet/root/v1", 64)
                   → rk' = out[0..32], ck = out[32..64]

KDF_CK(ck) = mk = HMAC-SHA256(ck, 0x01)
             ck' = HMAC-SHA256(ck, 0x02)

MessageKeys(mk) = HKDF-SHA256(mk, salt="meshchat/msg-key/v1", info="", 56)
                     → key = out[0..32], nonce = out[32..56]   // XChaCha20-Poly1305
```

### Инициализация

```
initiator: rk = SK; DHs = EK_A; DHr = SPK_B;
           (rk, CKs) = KDF_RK(SK, DH(EK_A, SPK_B))
responder: rk = SK; DHr = EK_A; DHs = новый X25519;
           (rk, CKr) = KDF_RK(SK, DH(SPK_B, EK_A))
```

### Сообщение

```jsonc
{ "dh": "<b64u ratchet pub>", "pn": 3, "n": 0, "ct": "<b64u XChaCha20 ct>" }
```

```
ad = utf8("meshchat/ratchet/v1|<dh>|<pn>|<n>")
ct = XChaCha20-Poly1305(key, nonce, padded_plaintext, ad)
```

Порядок приёма: skipped-key → при `dh != DHr` выполнить `skip(pn)` и DH-шаг →
`skip(n)` → взять mk из цепочки → расшифровать. Лимит пропусков 1000,
хранимых skipped-ключей 2000.

## 5. Внутренний payload

```
plaintext = u16be(len) || utf8(JSON) || 0x00 до кратности 256
```

| `t` | Поля | Смысл |
|---|---|---|
| `msg` | `id, ts, text, ttl?, replyTo?` | сообщение |
| `ack` | `ids[], state: delivered\|read, ts` | отчёт о доставке/прочтении |
| `typing` | `on, ts` | печатает |
| `profile` | `name, about?, ts` | обновление имени (в т.ч. при первом контакте) |
| `delete` | `ids[], ts` | «удалить у всех» |
| `file` | `id, ts, name, mime, size, index, total, data, ttl?` | чанк файла |

Файл: `data = b64u(u16be(len) || bytes || padding)` по 32 КиБ, до 8 МБ.

## 6. Конверт

```jsonc
{
  "v": 1,
  "to": "<tag получателя>",
  "id": "<b64u 9 байт>",
  "ts": 1730000000000,
  "k": "p" | "n",
  "ik": "…", "ek": "…", "opk": 12, "spk": 7,   // только для k = "p"
  "rm": { "dh": "…", "pn": 0, "n": 0, "ct": "…" },
  "pow": "<hex nonce>"
}
```

Ни `from`, ни темы, ни типа контента. Размер конверта ≈ 400–1200 байт в
зависимости от паддинга.

### Proof of work

```
target = BLAKE2b-256("meshchat/pow/v1" || tag || "|" || id || "|" || nonce)
валиден, если старших нулевых бит >= difficulty (объявляет relay в /v1/health)
```

Клиент перебирает `nonce` как hex-счётчик. Сложность 16 бит ≈ 65k хешей.

## 7. HTTP API relay

Все ответы — JSON. `CORS: *`.

| Метод | Путь | Тело / параметры | Ответ |
|---|---|---|---|
| GET | `/v1/health` | — | `{ok, name, version, pow, ttlMs, maxEnvelopeBytes}` |
| POST | `/v1/send` | `{envelopes: Envelope[]}` (≤32) | `{ok, accepted, rejected}` |
| POST | `/v1/wait` | `{tags: {tag: cursor}, timeoutMs}` (long-poll ≤30 c) | `{envelopes, cursor}` |
| GET | `/v1/pull` | `?tag=&cursor=` | `{envelopes, cursor}` |
| POST | `/v1/keys/:tag` | `{bundle, opks}` | `{ok, opks}` |
| GET | `/v1/keys/:tag` | — | `{bundle:{…,opk}}` или 404 |

`cursor` — монотонный `seq` сервера; клиент хранит последний на каждый тег.

### WebSocket `/v1/ws`

```
→ { "type": "sub", "tags": ["<tag>"], "cursors": { "<tag>": 12 } }
← { "type": "hello", "name": "…", "pow": 16 }
← { "type": "subscribed", "tags": […] }
← { "type": "env", "envelopes": [ … ], "cursor": { "<tag>": 13 } }
```

Ping/pong на уровне WebSocket каждые 30 с. Если upgrade невозможен — клиент
автоматически переходит на long-poll и продолжает с теми же курсорами.

## 8. Git-транспорт

```
box/<routing-tag>/<envelope-id>.json
```

* отправка: `PUT /repos/{owner}/{repo}/contents/box/{tag}/{id}.json` (base64 конверта, ветка по умолчанию `meshchat`);
* приём: список `contents/box/{свой tag}` → чтение `accept: application/vnd.github.raw` → `DELETE` после обработки;
* при `409` (ветка уехала) — один ретрай.

## 9. Версионирование

`v = 1` в конверте, payload'ах и state. Несовпадение — сообщение игнорируется
(не падает). Новые поля только добавляются, старые не переиспользуются.
