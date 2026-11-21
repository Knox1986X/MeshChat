# AI_ECOSYSTEM_HANDOFF_GUIDE.md
## Ecosystem Trust & IPC Bus v1 / EcoEnvelope v1

Версия документа 1.0-draft, 2026-11-20. Публичный стандарт для MeshChat, Зашифрованной Галереи, Локальных Офлайн-Карт и будущих приложений. Самодостаточное задание разработчику. **Не содержит общего секрета. Не означает, что SDK уже реализован или проверен аудитом.** MUST/SHOULD/MAY — нормативные требования. Production запрещён до утверждения installation registry, handshake profile и прохождения общей conformance suite. Незнакомая версия всегда rejected, не interpreted best effort.

## 1. Модель и два контура

Данные каждого приложения имеют независимые случайные storage keys. Не передавать DB keys, hardware wrapping keys или user PIN другому приложению. Подпись разработчика публична и разрешает опознавание приложения, но не разрешает автоматически читать всю Галерею. Первый контакт MAY автоматически создать **закрытый** канал, а доступ к данным требует user grant. У взломанного доверенного приложения остаются права выданных ему grants, поэтому минимизировать scope/TTL, показывать реестр связок и revoke.

### Контур1: OS identity
Android: приложения подписаны единым офлайн **APK signing key** владельца (это не TUF root и не IPC key). Manifest permission:
```
<permission android:name="org.meshchat.ecosystem.permission.BIND_V1"
 android:protectionLevel="signature" />
<uses-permission android:name="org.meshchat.ecosystem.permission.BIND_V1" />
<service android:name=".EcoBusService" android:exported="true"
 android:permission="org.meshchat.ecosystem.permission.BIND_V1">
 <intent-filter><action android:name="org.meshchat.ecosystem.BIND_V1" /></intent-filter>
</service>
```
Это проектный namespace: до production владелец обязан утвердить уникальный applicationId и authority owner; нельзя доверять чужому уже занятому package. Permission owner один, его сертификат проверяется перед bind, порядок установки и preclaim permission/name проверяются тестом. Android API29+ baseline. No sharedUserId, никакой общей UID/папки/БД.

Перед bind клиент делает explicit ComponentName из утверждённого registry и проверяет target package certificate. Service на **каждом Binder вызове**, до `clearCallingIdentity`/async dispatch, фиксирует `Binder.getCallingUid()`, `getPackagesForUid`, сопоставляет разрешённому package; caller-supplied package name не доказательство. Проверить `GET_SIGNING_CERTIFICATES`, текущий signer SHA256 DER certificate из `SigningInfo.apkContentsSigners`; multsigner — reject если весь exact signer set не утверждён. Shared UID/неоднозначность package — reject. Ротация signing lineage допускается только explicit подписанным registry policy; недостаточно «один из history совпал». Использовать проверенные API PackageManager, не парсить непроверенный APK как доказательство installed caller. Клиент и сервер проверяют друг друга. Сертификат сверяется на каждое новое bind и при package replacement; старые grants/channel закрываются после signer/install identity change. Android12 component exported должен быть explicit.

Linux: UDS `$XDG_RUNTIME_DIR/meshchat-eco-v1/<app-id>.sock`, каталог0700, socket0600, не `/tmp`, reject symlinks, owner check. `SO_PEERCRED` + pidfd где возможно, manifest/hash исполняемого пакета и санкционированный sandbox identity; UID/PID сам по себе **не доказывает** developer signature. При Flatpak через broker/portal с проверенным app ID, direct socket не экспортировать всем sandbox. Нельзя обещать защиту от произвольного процесса того же UID на обычном десктопе: ptrace, подмена libs/plugins и код-инъекция обходят наивный hash check. Fail-closed если executable identity не подтверждена, UI показывает weaker same-user isolation при таком deployment. Полноценная высокая уверенность требует изоляции пакета/пользователя.

Windows: `\\.\pipe\meshchat-eco-v1-<app-id>-<user-sid-hash>`; server устанавливает DACL только текущему SID (и необходимым OS principals), `PIPE_REJECT_REMOTE_CLIENTS`, предотвращает pipe squatting (`FILE_FLAG_FIRST_PIPE_INSTANCE`). Проверяет client token через impersonation с немедленным revert, PID/creation time, SID/session, executable signed manifest/hash и Authenticode/package identity; клиент проверяет server PID/package тоже. Same-user malware/admin не исключены: для сильной границы MSIX/AppContainer/broker. Не загружать пользовательские плагины/unsigned DLL в trust boundary.

Registry — versioned подписанный offline ecosystem-policy root документ с app ID, platform package name, allowed signer set/lineage, executable build manifests, allowed operations, min versions, expiry/revocations. Public root встроен; пустой allowlist = deny all. GitHub/Dropbox mutable файл не root of trust. Dev/debug root отдельный, release SDK его отвергает. Примерные package names ниже не реальные allowlisted приложения:
- Messenger `org.meshchat.messenger`, Gallery `org.meshchat.gallery`, Maps `org.meshchat.maps`.
- binary app IDs закреплены в §3; это локальные routing identifiers, не device IDs.

### Контур2: pairwise installation channel
Каждая установка создаёт independent identity key и ephemeral keys, storage key и install generation. Не использовать один hardcoded ecosystem secret, APK signing private key на устройстве или «общий мастер ключ трёх БД».

Кандидат handshake profile: audited Noise XX `Noise_XX_25519_ChaChaPoly_SHA256` (Noise spec) через pinned `snow` adapter, **не новый KDF-протокол**. Это classical local pairing, не обещание PQ против root/HNDL. Для local IPC OS-канал и endpoint isolation — первичная граница, отдельный PQ profile возможен позже. Noise static X25519 identity key per installation хранится wrapped hardware KEK (X25519 обычно не StrongBox-native). Манифест не подписывает private per-install key разработчиком: OS peer check связывает установку с приложением.

Порядок:
1. Обоюдная OS проверка, fresh32 bytes challenges, channel/role negotiation с suite/min version. Prologue = exact bytes `MESHCHAT-ECO-PAIR-V1\0` + initiator_app_id16 + responder_app_id16 + оба challenge32 + registry_hash32 + обе install_generation16. Freeze serialization test vectors до code freeze.
2. Noise XX ephemeral handshake, static keys verified против ранее pinned installation keys, если они есть. Auth payloads должны связать prologue и OS-observed package/installation identity. Нельзя принимать другой static key как автоматический restart. Первый pairing без старого pin возможен только после успешной OS проверки, default показывает user confirmation; автоматическое pairing MAY только без data grants.
3. Final handshake hash закрепляется как pair binding. Отдельный SDK exporter на основе документированного Noise split secrets, HKDF-SHA256 RFC5869, info `MESHCHAT-ECO-EXPORT-V1\0` + handshake_hash32 создаёт pair_root32. Точный split/exporter binding и аудит **ещё blocker**, не конструировать его молча; использовать проверенный exporter API или фиксировать отдельную reviewed спецификацию.
4. channel_id random16 от responder внутри authenticated payload, epoch random u64; fresh handshakes на reconnect с ephemeral FS, новые directional traffic keys. Pair root/identity pin sealed в независимых vaults; direction labels содержат source/target, channel_id и epoch. После restart новые handshake/epoch/keys, **не** сбрасывать seq под старым ключом. Приватные keys не попадают в Android Bundle/Intents/logs.
5. При переустановке, restore, замене signer или revoke — старый канал и grants invalid, явное re-pair. Счётчик из backup не продолжает старый key. Предложение новой identity показывается пользователю.

AEAD envelope suite v1 = ChaCha20-Poly1305 RFC8439, key32, nonce12, tag16. Directional traffic key = HKDF-SHA256(IKM=pair_root, salt=channel_id16, info=`MESHCHAT-ECO-TRAFFIC-V1\0` || src16 || dst16 || epoch_u64be, L=32), только после утверждённого exporter. Разные направления MUST иметь разные keys. Nonce = 4 zero bytes || seq_u64be. `seq` начинается0, строго увеличивается; разрыв/rollback состояния вызывает fresh handshake, не re-use. Max2^32 envelopes/key, затем rekey; overflow rejected. Header — AEAD AAD целиком. Никаких mutable полей вне аутентификации. XChaCha не объявлять wire-compatible с ChaCha.

## 2. Константы и строгий бинарный формат

Все integers unsigned big-endian. Не использовать платформенный memory layout. Нет JSON/CBOR ambiguity в outer header. Max serialized envelope65536 bytes включая header и tag. Header **108 bytes**, потом `ciphertext[payload_len]`, потом16-byte tag. `payload_len` — длина **plaintext/ciphertext без tag**. Header magic ASCII `ECO1`, version1, flags0, header_len108. Reserved0. Неизвестный flag/type/version — reject.

|Offset|Bytes|Поле|Ограничение|
|---:|---:|---|---|
|0|4|magic|45 43 4f 31|
|4|1|version|1|
|5|1|flags|0|
|6|2|header_len|108|
|8|16|source_app_id|из registry|
|24|16|target_app_id|ровно local app|
|40|16|channel_id|уже pinned channel|
|56|8|epoch|current authenticated handshake epoch|
|64|8|seq|0..2^32−1, monotonic per direction|
|72|8|issued_at_ms|Unix UTC ms, не источник крипто-уникальности|
|80|4|ttl_ms|1..300000|
|84|2|payload_type|таблица ниже|
|86|2|reserved|0|
|88|4|payload_len|0..65412, schema limits дополнительно|
|92|16|stream_id|нулевой если не stream; random16 иначе|

Wire total =108+payload_len+16. Нет padding outer IPC; padding network — отдельный layer. Reject trailing bytes, truncated input, invalid lengths **до allocation**, неполный поток не success. `timestamp` не replay protection: replay по `(channel,direction,epoch,seq)`, сохраняем receive state атомарно с обработкой. IPC control порядок строго последовательный; транспорт гарантирует порядок, иначе resync fresh channel. Повтор ciphertext может вернуть cached success по request_id, но не выполнить операцию повторно. Злоумышленный скачок seq не должен записываться до verify tag. Допуск часов±120s; TTL проверяется после auth, локальная выдача grant использует monotonic clock. Clock failure → deny expired-sensitive grants/re-pair, не «accept forever».

### App IDs (16 bytes)
- Messenger: `00000000000000000000000000000001`
- Gallery: `00000000000000000000000000000002`
- Maps: `00000000000000000000000000000003`
- будущие: offline signed registry выделяет уникальное значение; не выбирать случайный collision-prone short ID самостоятельно. Это namespace документа, до production registry утверждается владельцем.

### Payload schemas
Plaintext payload = deterministic CBOR RFC8949: definite lengths, map keys unsigned integers ascending, shortest encoding, no duplicate/unknown keys, no floats/NaN/tags/indefinite items. UTF8 valid, без NUL в identifiers; нормализацию текста не использовать для auth. Bounds decoder: depth≤8, map≤32, array≤4096, individual text≤4096 bytes. До канонизации не подписывать/проверять две разные версии одного объекта. Crypto schema и парсеры fuzz, общий corpus для Rust/Kotlin/C#. `bstr16/32` — exact length.

Общая рамка CBOR map `{0:request_id(bstr16),1:grant_id(bstr16),2:body(map)}`. request_id случайный unique128, сохраняется для idempotency TTL10min. Для GRANT_REQUEST grant_id=zero16; для остальных действующий grant. Ошибки не включают чувствительные координаты/имена/URI.

|Type|Название|Body (integer keys, все обязательны если не указано)|
|---:|---|---|
|1|GRANT_REQUEST|0 operation(uint16),1 resource_handle(bstr16,zero для picker),2 ttl_ms(uint32≤300000)|
|2|GRANT_RESULT|0 allowed(bool),1 scopes(array uint16,max8),2 expiry_ms(uint64),3 selected_resource(bstr16); denied использует zero16 grant/resource и scopes[]|
|3|REVOKE|0 reason(uint16 1=user,2=lock,3=expiry,4=identity_change)|
|4|ERROR|0 code(uint16),1 retryable(bool); no freeform strings|
|16|MEDIA_OFFER|0 sanitized(bool),1 profile(uint16),2 mime(tstr allowlist),3 size(uint64),4 sha256(bstr32),5 resource(bstr16)|
|17|STREAM_OPEN|0 size(uint64),1 chunk_size(uint32=65536),2 count(uint32),3 sha256(bstr32),4 mime(tstr)|
|18|STREAM_CLOSE|0 verified(bool),1 sha256(bstr32)|
|32|GEO_POINT|0 lat_e7(int32),1 lon_e7(int32),2 accuracy_cm(uint32),3 valid_until_ms(uint64),4 precision_m(uint32)|
|33|GEO_TRACK_OFFER|0 size(uint64),1 sha256(bstr32),2 points(uint32≤100000),3 format(uint16=1 for sanitized GPX)|
|34|LIVE_LOCATION|GEO_POINT fields +5 share_id(bstr16),6 ordinal(uint64),7 stopped(bool)|

CBOR signed ints разрешены **только** lat/lon: −900000000..900000000 и −1800000000..1800000000. accuracy≤100000000cm, precision1..100000m, resource file max512MiB по default policy, пользователь может уменьшить, увеличение требует versioned policy/test. Max live duration15min default, hard cap1h, ordinal strictly increasing, stale updates ignored. GEO may быть sensitive даже без точности. Истечение waypoint — best effort UI/ключ cleanup, не remote erasure guarantee.

Scope values:1 `media.pick_sterilized`,2 `media.import_private`,3 `geo.send_selected`,4 `geo.open_offline`,5 `geo.live_share`,6 `gallery.map_selected`. Не существует `read_all_databases`, `export_all_keys`, wildcard scope. Каждый grant связывает source+target+resource+operation+maximum bytes+expiry+lock state, непередаваем, default single-use. Verify grant на OPEN и в ходе stream; lock/revoke closes handles/cancels worker, уже полученное plaintext не забрать. Автоматически доверенный signed app не означает автоматический sensitive grant.

Error codes:1 UNSUPPORTED_VERSION,2 AUTH_FAILED,3 REPLAY,4 GRANT_DENIED,5 LOCKED,6 EXPIRED,7 LIMIT_EXCEEDED,8 IDENTITY_CHANGED,9 INTEGRITY_FAILED,10 CLOCK_UNTRUSTED. Не возвращать подробности unknown app/cert до аутентификации; OS-bound errors generic.

## 3. IPC contracts и stream

Discovery action `org.meshchat.ecosystem.BIND_V1` только для registry lookup; **сам bind всегда explicit**. UI action `org.meshchat.ecosystem.PICK_MEDIA_V1` explicit Activity с signature permission/runtime caller check и grant; она возвращает opaque resource handle, не plaintext path. Result доверять только от ожидаемого component/package и проверить envelope auth. Не использовать implicit broadcasts/result spoofing. Intent extras: `eco_request` byte[]≤65536 или opaque request handle16; никаких keys/plaintext гео/media. URI scheme `meshchat-eco://v1` **не security boundary и не IPC API**; custom URI hijackable, не вкладывать secrets. Contact invites отдельно: verified HTTPS App Link или offline QR; это не EcoEnvelope route.

Нормативный bound service интерфейс концептуально:
```
getProtocolInfo() -> public versions (no sensitive info)
handshake(bytes<=65536) -> bytes<=65536
transact(envelope<=65536) -> envelope<=65536
openStream(authenticated STREAM_OPEN envelope) -> ParcelFileDescriptor
closeChannel(channel_id)
```
Every method validates actual caller UID, even open/close. Binder лимит около1MiB не использовать как application bound. SDK лимит64KiB. Не передавать Android hardware handles через UniFFI как сырые addresses.

ContentProvider по умолчанию **не экспортируется**. Если отдельный adapter необходим: authority `<applicationId>.eco.v1`, `exported=false`, `grantUriPermissions=true`, one-off `content://<authority>/v1/stream/<random128>` с read-only explicit grant конкретному проверенному package; runtime cert/UID и capability check на openFile, expire≤60s, revoke после close/lock, no query/list/update/delete и no filesystem path disclosure. URI capability не включает key, stream всё равно ciphertext; не разрешать третьим приложениям переслать grant. Предпочтителен PFD через bound service, без URI surface вообще. Не смешивать PFD и ContentProvider в MVP без нужды.

PFD/UDS/pipe передают **encrypted** поток. Это не kernel one-use fd: получатель может dup; one-use обеспечивается SDK capability и state machine. Файловый stream key случайный32, передаётся только внутри auth STREAM_OPEN body расширенного профиля; **для v1 вместо отдельного key используется derive** HKDF(pair_root,salt=stream_id,info=`MESHCHAT-ECO-STREAM-V1\0`||src||dst||epoch,32). Stream_id random16 unique в channel lifetime, collision reject. STREAM_OPEN.header.stream_id nonzero; header.stream_id обязан совпасть у CLOSE. Seq envelope не используется как chunk nonce.

Каждый stream frame: index u32be, length u32be (1..65536), ciphertext[length], tag16. AEAD ChaCha20Poly1305 key derived per stream, nonce=zero8||index_u32be. AAD=`ECS1`||stream_id16||src16||dst16||epoch_u64be||total_size_u64be||count_u32be||index_u32be||length_u32be. Count=ceil(size/65536); size0 поток запрещён. Все chunks кроме последнего full65536, последний exact remainder (65536 если кратно); индексы0..count−1 strictly ordered; no trailing frames. Final sha256 plaintext должен совпасть с authenticated OPEN и CLOSE, преждевременный EOF всегда fail; max512MiB baseline. Partial receive в encrypted staging storage, не публиковать «сохранено» до final hash. Декодировать previews только после отдельного authenticated bounded media chunk в соответствующем media profile, не отдавать произвольный partial video decoder.

Открытые данные присутствуют в RAM источника, decoder/encoder, назначения, kernel/codec buffers; требуется bounded buffers/Zeroize где возможно, но не обещать «ни одного байта в памяти». Передача без external plaintext temp. Desktop pipes PFD заменяются authenticated local byte streams с теми же frame semantics. No network calls внутри ecosystem-sdk.

## 4. Три интеграции

**Messenger↔Gallery:** пользователь нажал выбрать → explicit trusted picker → grant `media.pick_sterilized` → Gallery декодирует pixels/PCM, encoder normalizes metadata → MEDIA_OFFER sanitized=true, profile1 (фиксированный утверждённый allowlist JPEG/PNG/H264+AAC, версии codecs в signed policy) → encrypted stream → Messenger проверяет hash и policy, дополнительно independently verifies container metadata → own E2EE. Флаг `sanitized=true` не доказательство; компрометированная Gallery способна лгать. Неизвестный профиль/невозможность стерилизации=deny. Полученное из чата медиа: отдельный `media.import_private` grant → Gallery sandbox decode, encrypted album, не MediaStore/Downloads. Original receive bytes считаются hostile.

**Messenger↔Maps:** выбранная точка/precision/TTL → `geo.send_selected` → GEO_POINT → E2EE network16KiB → peer `geo.open_offline` grant → offline maps. Никаких Google/Apple геокодеров/тайлов, url intents с координатами или location в notifications. Track GPX через encrypted stream, parser без XXE/DTD. Live share явно запускается/останавливается с timer/indicator и `geo.live_share`; data saver/lock могут остановить, UI это показывает; никогда автоматически возобновлять expired share после reboot.

**Gallery↔Maps:** пользователь выбирает album subset → `gallery.map_selected` → scoped geo points+opaque photo handles; Maps не получает DB key/полный альбом, preview по новому ограниченному grant. Геометки в Gallery сохраняются private, но экспорт в Messenger всегда проходит sanitizer без EXIF/GPS. Приложение Maps не связывает приватные photo handles с remote analytics (remote analytics запрещена).

## 5. Rust SDK contract (целевой API, не наличие реализации)
```
trait PeerVerifier { verify_os_peer(&self, connection: OsPeer) -> Result<VerifiedPeer>; }
trait KeyProtector { seal(&self, purpose: Purpose, secret: SecretBytes) -> Result<KeyRef>; }
trait GrantUi { confirm(&self, request: GrantRequest) -> Result<UserDecision>; }
struct EcoBus; struct Pairing; struct Channel; struct VerifiedEnvelope;
EcoBus::connect(VerifiedPeer, Policy) -> Result<Pairing>;
Pairing::advance(BoundedBytes) -> Result<PairingStep>;
Pairing::finish(UserDecision) -> Result<Channel>;
Channel::request_grant(Operation, ResourceHandle, Limits) -> Result<Grant>;
Channel::seal(&mut self, GrantRef, Payload) -> Result<EnvelopeBytes>;
Channel::open(&mut self, EnvelopeBytes) -> Result<VerifiedEnvelope>;
Channel::stream_open(&mut self, GrantRef, StreamMeta) -> Result<EncryptedStream>;
Channel::revoke(&mut self, GrantRef) -> Result<()>;
Channel::close(&mut self); // cancel, zeroize, release handles
```
Типы bounded и secrets не реализуют Debug/Serialize; не хранить plaintext в Rust String дольше UI boundary. `VerifiedPeer`, `VerifiedEnvelope`, `Grant` нельзя сконструировать извне из bool/ID. Ошибки typed, fail-closed. Crypto adapter async cancellation не теряет atomic seq reservations. FFI отдаёт handles+bounded byte vectors, ownership/lifetime явно задокументированы, no use-after-free. Ключевые буферы `zeroize`/`secrecy`, mlock best effort с reported status. Store receive replay counter и business effect одной транзакцией или idempotent prepare/commit, durable send seq reservation до emit. Новое приложение добавляет schema/scope через registry review, а не использует `media` для произвольного кода.

## 6. Conformance и запреты ИИ

Обязательно: vectors endian/header/tag/AAD; unknown fields/types/version reject; wrong target/signer/key; reused seq/stream_id; timestamp+TTL; reboot/rollback fresh keys; lock mid-stream; truncated chunk99%; final hash mismatch; swap src/dst; replay GRANT; package replacement; provider forwarding; explicit UID check on every call. Cross-implementation corpus Rust/Kotlin/C#, independent review. Эталон header codec в этом репозитории НЕ реализует crypto/replay/CBOR, не подключать в production.

Запрещено:
- hardcoded private/shared integration key; DB key sharing; derivation из package name/certificate/public ID;
- слепое доверие `signature` без runtime cert или `SO_PEERCRED` без package isolation policy;
- implicit intent с секретом, exported provider без scoped check, world-readable files, plaintext temp;
- nonce из timestamp/random32, восстановление seq из старого backup, AEAD без AAD;
- unbounded deserialization, unsafe XML, автоматическое открытие remote URL, debug logs координат/PIN;
- собственные криптопримитивы/непроверенный Noise exporter; утверждение «работает PQ» на классическом X25519;
- обход предупреждений/consent ради UX, превращение trusted developer в unlimited data permission;
- секреты в GitHub, Dropbox, CI, prompt, issue, crash report; загрузка реальных пользовательских traces.

## 7. Готовый промпт для нового проекта

> Ты реализуешь приложение экосистемы MeshChat. Прочитай полностью приложенный AI_ECOSYSTEM_HANDOFF_GUIDE.md версии1.0-draft и registry конкретного релиза. Не придумывай приватные/общие ключи, package IDs, сертификаты или отсутствующие API. Если registry/SDK/exporter profile ещё не утверждён, реализуй только типизированные interfaces, parser/conformance tests и mock вне release; production pairing должен fail-closed. На Android проверяй signature permission И фактический Binder UID/package/current signer с обеих сторон, explicit components, scoped user grants; на Linux/Windows честно учитывай same-user malware и требование sandbox. Используй независимый storage key и hardware wrapping, EcoEnvelope exact108-byte header, authenticated target/epoch/seq и утверждённый SDK AEAD. Не реализуй crypto самостоятельно. Передавай тяжёлые данные encrypted streams без plaintext filesystem. Gallery удаляет метаданные при network export; Maps работает offline без внешних тайлов/геокодинга. Не выводи secrets в логи/промпты. Создай threat model, dataflow с plaintext RAM, negative tests и совместимые test vectors, список неподтверждённых гарантий и release blockers. Не называй прототип готовым защищённым продуктом. Любое расширение wire protocol проходит versioned review, не делай silent fallback.
