# MeshChat: архитектурный проект и границы гарантий

Дата: 2026-11-20. Статус: инженерная baseline, не сертификат безопасности.
Обозначения: **[D]** документированное свойство/API/стандарт; **[A]** проектное допущение/решение; **[E]** гипотеза, требующая измерения; **[B]** release blocker. Ссылки и проверенные upstream — SOURCES.md. MUST — обязательное требование реализации.

## Вопросы владельцу (не останавливают проект)
1. Допустим ли AGPLv3 для всего распространяемого связанного клиента и публикация соответствующих исходников/сборочных скриптов? Допущение: да, юридическая проверка до кода.
2. Доступны ли минимум два административно независимых оператора, юрисдикции и платёжные контуры? Допущение: два оператора, но сговор считается возможным.
3. Какой бюджет трафика/батареи и допустимая задержка при заблокированном Android? Допущение: UnifiedPush предпочтителен, без него eventual delivery, не гарантированные секунды.
4. Нужен ли экспорт истории при потере устройства? Допущение: только ручной локальный экспорт истории, не действующего состояния ратчета.
5. Каковы реальные домены/package IDs, developer fingerprints, minSdk и доступные модели телефонов? Допущение: Android 10/API29+, arm64-v8a, CI x86_64 эмулятор; production ID и ключи ещё не утверждены.
6. Является ли защита архивируемых **маршрутных** метаданных от квантового противника обязательной в v1? Допущение: да; отсутствие проверенного гибридного внешнего туннеля блокирует production, не ведёт к классическому fallback.

## 1. Инженерный вердикт

Android Compose APK → CachyOS → Windows. Единый Rust core хранит состояние и реализует E2EE/очереди/контейнер/SDK; ОС выполняет сеть, ключевое wrapping, UI, уведомления, медиа sandbox и обновления. UniFFI переносит команды и непрозрачные handles, а не долгоживущие копии ключей в JVM/C#.

**Гарантируемые при корректной реализации условия:** шифротекст на всех релеях; аутентичность после независимой проверки контакта; независимые device keys и storage keys приложений; никакого plaintext fallback; никакого автоматического доверия сменившемуся ключу. Безопасность против HNDL зависит от конкретного гибридного handshake и продолжающегося PQ-ратчета, а не слова «Rust».

**Не гарантируем:** анонимность при сговоре ISP+Cloudflare+VPS, доставку в отключённом интернете, неразличимость протокола для DPI, отсутствие IP у входного узла, защиту открытого экрана от вредоносной ОС/камеры/принуждения, удаление копии у собеседника. ISP и оба релея могут сопоставить вход и выход по времени и размерам даже при 16 KiB ячейках. Никакое отсутствие телефонного номера это не отменяет. Изъятый BFU-телефон с сильным паролем и недоступными hardware keys защищён лучше AFU; разблокированный аппарат и root принципиально слабее. Не ослаблять lock policy ради фоновой доставки.

### 1.1 Матрица наблюдателей
Хранение ниже — наша целевая политика, а не обещание поведения чужой инфраструктуры. Чужие сроки неизвестны/могут быть бессрочными.

|Наблюдатель|Видит|Корреляция|Хранение|Мера и предел / сигнал пользователю|
|---|---|---|---|---|---|
|ISP/сотовый/Wi-Fi/DPI|IP клиента/edge, DNS если утёк, SNI без ECH, TLS/QUIC отпечатки, время/объём/частота|абонент↔сессия↔медиа burst; активное зондирование домена|чужое неизвестно|DoH+ECH где доступны, native TLS, H2 fallback, padding/окна; «ECH недоступен» в сетевой диагностике, не обещать обычный браузерный отпечаток|
|Cloudflare на входе A|клиентский IP, TLS plaintext HTTP path/headers, User-Agent, соединения, размер OHTTP, адрес VPS|один IP/HTTP connection связывает разные очереди даже если ID зашифрованы|провайдер решает; отключаем доступные logs/analytics, контракт не криптография|общий путь /v1/exchange, нет cookies/стабильных device headers, внутренний туннель; жёлтый индикатор «вход видит IP»|
|VPS очередей A|ID ячеек очереди, enqueue/dequeue, токены доступа, размеры/TTL, IP входа|писатель/читатель одной очереди; несколько очередей в одной сессии; граф статистически|ячейки ≤30 дней, ACK удаляет; дедуп TTL+7 дней; техагрегаты 7 дней|переключение сессий/пер-контактные capabilities, разные операторы/egress; отсутствие IP отправителя не исключает граф|
|CF Workers/DO/R2 в B|весь код/память узла 2, queue IDs, частота/доступы, storage|граф очередей; с входом — IP|чужие backups неизвестны|не считать Worker независимым от CF; E2EE скрывает текст, не маршруты|
|UnifiedPush distributor/опциональный FCM|endpoint/token, IP регистрации/доставки, wake-up время, подписка приложения|токен связывает чаты и запуски, возможна связь других приложений|не контролируем|пустой wake-up, coalescing, отдельные app tokens; UI явно сообщает поставщика. FCM отсутствует в baseline APK|
|GitHub/Dropbox/CDN обновлений|IP загрузки, аккаунт оператора, source/артефакты, времена, запрос версии|владелец репо↔проект, загрузки↔использование|их политика/история версий|только публичные материалы, TUF/локальная подпись, независимые зеркала; не загружать реальные трассы|
|Спамер/ботнет|публичный вход/приглашение, свою очередь, размеры ответов|вычисляет наличие сервиса, DoS|его решение|capabilities, invite TTL/use counter, quotas, bounded PoW, равномерные ошибки; пользователь видит переполнение/задержку|
|Злой контакт/скомпрометированный peer|текст/медиа/координаты, время получения, известную ему личность|внешность/фон фото/PRNU/гео/социальные данные; экспорт истории|неограниченно|минимизация данных и geoshare TTL; нет запрета фотографировать экран и гарантии self-destruct|
|Физический доступ BFU|APK, размеры/наличие файлов, до unlock нет credential keys|известность приложения, ciphertext snapshots|пока носитель существует|CE storage+Keystore auth+сильная фраза; BFU не распространяется автоматически на десктоп|
|Физический доступ AFU locked|ОС уже получила часть FBE keys, фоновые процессы, часть RAM|форензика/уязвимости ОС|неизвестно|закрыть vault/стереть buffers на lock, запрет background decrypt; AFU слабее BFU|
|Разблокирован/принуждение|экран, ввод, доступные ключи через легитимное API|всё открытое и действия пользователя|снимки/копии|app lock, короткий timeout, локальные предупреждения; duress не гарантия|
|Root/kernel/Accessibility/кейлоггер|от IME/экранных узлов до всей RAM и IPC; root исполняет код|все три приложения и hardware key oracle|неограниченно|минимум открытого, sandbox, предупреждение Accessibility; root detection не доказательство безопасности|
|Глобальный/частичный наблюдатель|оба конца, общий radio wake, burst lengths|traffic confirmation даже без IP на VPS|архив бессрочно|независимость/батчинг/опциональный внешний Tor; low latency несовместима с сильной глобальной unlinkability|
|HNDL|архив E2EE и внутренних туннелей, публичные ключи|поздняя расшифровка классического X25519; классические подписи в будущем подделываемы|бессрочно|проверенный hybrid KEM для контента И маршрутизации; долгосрочная PQ-аутентификация — отдельный незакрытый риск|

Без номеров всё равно связываются: один TLS connection несёт несколько контактов; wake token обслуживает устройство; одновременные запросы Галереи/Карт выдают общий телефон; общие DNS, crash analytics, developer update checks связывают приложения. Поэтому нет общей сетевой аналитики, device UUID, advertising IDs, общего push endpoint, общей телеметрии; карты и галерея по умолчанию вообще не выходят в сеть. IPC app IDs остаются локальными и не попадают в message headers. Проверка общего разработчика — намеренная публичная связь приложений, не анонимность владельца.

## 2. Выбор архитектуры: криптография, Cloudflare и хранение

### 2.1 Минимум три конфигурации
|Конфигурация|Что скрывает / кому доверяем|Доступность/скорость/цена|Решение|
|---|---|---|---|
|A: CF вход → независимый VPS queue gateway; SQLCipher+chunks локально|CF не читает inner queue IDs при корректном туннеле; VPS видит IDs и CF IP. Сговор восстанавливает связь|два RTT/оператора; CF block ломает вход; VPS single point до репликации|**стартовая**; независимый запасной вход, не прямой клиент→queue|
|B: независимый вход → CF Worker/DO/R2 queues|CF как исполняющая сторона читает routing. Шифрование в Worker не скрывает metadata от CF|хорошая масштабируемость; DO/R2 операции/egress/запросы; общий vendor|не удовлетворяет требованию скрыть routing от CF; только осознанный альтернативный deployment, не автоматический fallback|
|C: независимый вход → независимый queue VPS (CF только зеркало статики)|не доверяем одному узлу, но коалиция двух всё коррелирует|нужны DDoS бюджет, несколько доменов/операторов; легче при региональном CF block|обязательный резерв с тем же privacy class, при доказанной независимости|
|D: прямой VPS/P2P → peer, монолитный контейнер|VPS/peer видит IP, размер контейнера остаётся артефактом|меньше RTT, хуже metadata; hidden volume не лечит сеть|не по умолчанию, только после отдельного согласия; hidden volume не MVP|

Триггеры пересмотра: региональный CF failure >5% сессий/сутки, месячная стоимость >утверждённого бюджета, недостаточная независимость операторов, p95>SLO 3 дня, отсутствие проверенного PQ-inner профиля. Роль ingress/queue задаётся подписанным конфигом с `privacy_class`, `operator_id`, keyset/version/expiry. Клиент запрещает конфиг, где оба оператора фактически один, если выбран split-trust режим. Подпись не доказывает независимость юрлиц — это процедура оператора.

### 2.2 Что именно шифруется
`OS TLS/WebPKI → OHTTP request(inner authenticated gateway tunnel(queue command(E2EE payload)))`.
OHTTP RFC9458 использует HPKE RFC9180, а не произвольный WebSocket VPN. OHTTP relay пересылает opaque encapsulated request одному gateway; gateway видит HTTP route и queue commands. Долгий опрос реализуется ограниченным запросом/ответом, не якобы стандартизованным OHTTP WebSocket stream. Сессии Noise поверх WS — иной профиль, отдельно аудитируется; нельзя объявлять совместимым RFC9458.

Обычный HPKE X25519 **не PQ**. Обычный Noise X25519 тоже. Принято: content hybrid из поддерживаемого libsignal; для routing поверх стандартного OHTTP нужен независимый **проверенный гибридный gateway profile X25519+ML-KEM-768** с domain-separated KDF и transcript binding. Не составлять самому «XOR двух ключей». До заморозки спецификации, тестовых векторов, downgrade tests и внешней проверки это **B-NET-PQ**. Допустим классический исследовательский стенд с надписью «маршрутные метаданные не защищены от HNDL», но не production v1. Стандарт OHTTP сам не даёт FS старых запросов при компрометации статического gateway KEM secret: нужны короткоживущие подписанные prekeys/сессионный ратчет и уничтожение; replay gateway не заменяет app replay DB.

В APK встроен офлайн root key конфигурации. Он подписывает набор отдельных Ed25519 verification keys и X25519/KEM gateway keys с ролью/доменом/эпохой/сроком; Ed25519 не использовать как X25519 encryption key. Проверяем signature, key ID, suite, downgrade floor, TTL и checkpoint. Публичный gateway key pin — объект с offline trust, а не быстро меняющийся CF certificate. HPKE base шифрует серверу, но не аутентифицирует клиента; подтверждение gateway response связывается с request context. Конфигурация не может менять contact identities.

TLS: стандартный WebPKI и hostname validation, без edge SPKI pins, без отключения проверки времени. Нативный стек НЕ гарантирует совпадение рукопожатия с браузером «на 100%»: версия TLS, ALPN, QUIC и HTTP patterns различаются. Android platform TLS/H2 baseline; Google-independent bundled Cronet может дать QUIC, но это отдельный supply-chain dependency и не обязательный MVP. H3→H2 автоматичен, E2EE и gateway auth неизменны. ECH зависит от resolver, HTTPS RR, стека, CDN/страны; отображать факт negotiated/unknown, не выдавать enabled setting за результат.

DoH RFC8484: явный resolver bootstrap с подписанным конфигом/заранее доверенными адресами, hostname TLS, запрет fallback в system DNS; QUIC/HTTP libraries не должны самостоятельно resolve destination. SOCKS5 remote DNS на десктопе, запрет прямого egress при включённом proxy; локальный SOCKS не шифрует удалённое плечо сам по себе. DoH provider видит имена; bootstrap, captive portal probe и обновления тоже проверяются на утечки. Доступ к порталу открывается отдельно с предупреждением, не через секретный клиент.

### 2.3 Реальные ограничения Cloudflare
Проверенная 2026-11-20 копия Workers limits: body Free/Pro 100 MB, Business 200 MB, Enterprise до 5 GB self-serve; 128 MB/isolate, CPU Free 10 ms, Paid до 5 min (default 30s), Free 100k запросов/день. Это не обещание тарифа и не единые лимиты CDN/Workers/DO/Tunnel. На рестарте Workers соединения могут разрываться; документация описывает drain до 20 минут, но аварии могут раньше. Нет гарантированного бесконечного WS. CDN proxy read/write timeouts, WS frame limit и idle policy проверять именно для выбранного продукта и контракта перед релизом.

MVP: POST/ограниченный long poll ≤20s, одна opaque body cell =16384 байт; batching 1/4/16 ячеек только отдельным профилем. HTTP/TLS headers и record overhead сверх размера; это **не 16384 байта на IP-проводе**. Не compression/content-encoding. `Cache-Control: no-store`, не CDN cache для delivery, запрет cache key по queue. Worker стримит, не буферит видео; queue origin принимает только ingress credentials/mTLS, CF forwarding headers очищаются, IP клиента не пересылается. WAF allow rule для узкого endpoint, не глобальное выключение WAF; Bot Fight/JS challenge несовместимы с non-browser binary API — staging gate. Тестировать 413/429/52x, restart и half-close. Стоимость = requests+CPU+storage operations+retention+egress по актуальному тарифу; на 100 MiB тысячи requests, бюджет считаем до запуска.

Active probing: обычный сайт/API на домене, uniform bounded errors без версии crypto и queue enumeration, а одноразовый ingress admission ticket в заголовке. Билет не стабильный ID и не queue token; его выдача сама требует rate-limit и может быть обнаружена. Внешние paths/headers видит CF. «Правильный» HTTP ответ без билета не делает endpoint нераспознаваемым при статистике/утечке URL. Anti-abuse IP rate-limit на входе кратковременный (RAM ≤10 минут), не журналируемый.

### 2.4 Криптостек и лицензии
|Стек|Свойства/зрелость|Лицензия и решение|
|---|---|---|
|libsignal Rust через собственный adapter|Signal Double Ratchet/PQXDH; upstream содержит pqxdh, triple_ratchet/tahini. Нельзя предположить, что включение крейта автоматически включает continuous PQ PCS|AGPL-3.0, GitHub license проверен; внешнее использование unsupported/API unstable. Выбираем при AGPL-consent, pin commit и сопровождении fork adapter без изменения примитивов|
|Double Ratchet + самостоятельный Rust ML-KEM wrapper|MIT/Apache примитивы существуют, но новая композиция ≠ аудированный Signal; FS/PCS зависит от state machine|не замена аудиту; отвергнуть самописный протокол ради permissive license|
|OpenMLS RFC9420|групповые epochs, member removal/update; RFC baseline не автоматически PQ|MIT проверен, phase2; выбранные crypto providers/сборка проверяются отдельно|
|RustCrypto, zeroize/secrecy, rusqlite+SQLCipher, UniFFI, Tokio|строительные блоки; Zeroize не очищает все копии/регистры/OS codecs|проверить SPDX каждого lockfile и SQLCipher Community vs commercial; permissive компоненты не отменяют AGPL linked work|

[А] Весь связанный клиент планировать AGPL-3.0-compatible, сохранить notices, исходники соответствующей версии, build scripts и obligations network use если применимо; AUR/Flatpak/APK/Windows не меняют copyleft. Лицензию собственных новых документов/кода владелец ещё утверждает, license grant здесь не выдумываем. Проверка SBOM/cargo-deny и юрист — release gate. Проверка конкретного PQXDH suite обязательна: старое Kyber и ML-KEM-768 не взаимозаменяемые wire formats. Нельзя подписать «ML-KEM» поверх старого libsignal handshake. Утвердить exact adapter version, suite IDs, API, векторы и поведение Triple Ratchet прежде чем назвать content PQ PCS.

### 2.5 Идентичность и очереди
Устройство генерирует локальный root signing key; снаружи используются независимые pairwise contact identity keys, а не один глобальный публичный root. Никакой общедоступной директории ключей. Внутри локального device roster root нужен для linking/revocation; его нельзя посылать всем контактам, иначе это глобальный ID. Контакт получает делегированный pairwise device certificate через проверенный канал.

Приглашение: 256-bit случайный bearer secret, one-use CAS на сервере, default TTL24h, максимум 7d. URL содержит секрет в fragment, никаких web analytics/referrer/preview fetch. Android App Link проверяется, но QR offline предпочтительнее; handler запрещает автоматическое consume при preview. Queue read/admin/write capabilities независимы по 256 bits; server хранит keyed hashes, сравнение constant-time. Invite содержит protocol version, suite floor, key/config hash, ephemeral prekey/подпись, expiry, rendezvous capability, не имя владельца. Реплей использования отвергается атомарно. Похищенный до активации bearer даёт гонку/MITM без SAS: это не устраняется TLS.

После PQ handshake оба видят SAS из transcript hash (минимум 60 bits кодирования, 12 decimal pairs или 6 слов из зафиксированного списка 2048 слов; конкретный wordlist hash фиксируется до релиза), проверяют по независимому каналу. До проверки разрешить draft, но **отправка пользовательского контента заблокирована по умолчанию**. Нет тихого TOFU при restore. SAS должен включать роли, обе identity keys, device cert, suite и обе queue bindings, защищать от reflection/UKS. Link не доказательство человека.

Контакт = две однонаправленные очереди разных random IDs; для каждого устройства в будущем отдельные session endpoints. Gateway неизбежно знает связь writer/read одного ID и может делать statistical graph inference. Ротация capabilities после revoke/подозрения и каждые 7d или 1000 cells (что раньше), переход через authenticated control message, overlap ≤24h, ack idempotent; старую admin capability хранить до delete ACK. Rotation не стирает наблюдения сервера. Для VPS failover очередь не возникает из ничего: contact заранее имеет второй queue binding у независимого оператора; ciphertext retry одинаковый, recipient dedup. Репликация одного оператора улучшает availability, но не anonymity.

### 2.6 Ратчет, FS/PCS и атомарность
FS: удалить использованный message key/старую chain key после durable commit; skipped keys bounded (≤1000/сессию, TTL7d), явная tradeoff с задержанными сообщениями. SQL UPDATE не стирает ключ из WAL/снапшота; нужен отдельный per-epoch wrapping key вне старой DB или не обещать физическую FS против snapshots. Удаление ключа из RAM — best effort; SQLCipher один на всю БД не обеспечивает FS против исторической копии вместе с этим ключом.

PCS: новые честные DH/KEM contributions после прекращения компрометации; классический DH PCS не равен PQ PCS. Пока вредонос остаётся на устройстве, самоисцеления нет. Новая identity key после переустановки — состояние `IdentityChanged`, остановка исходящих, сохранить старую историю read-only, верификация нового устройства по OOB; signed old-device migration полезна, но скомпрометированный old key не доказательство безопасности.

Send transaction: зарезервировать уникальный message ID/sequence → derive+encrypt в core → **одной транзакцией** updated ratchet+immutable ciphertext outbox → fsync/commit → только потом сеть. При retry посылается тот же ciphertext, не шифруется заново старым ключом. Inbound: verify/decrypt в tentative state → атомарно ratchet+dedup+message в SQLCipher → commit → ACK. Crash до commit означает retransmit; crash после commit — dedup ACK. Не выдавать plaintext UI до commit. Не делать ACK только по доставке TCP.

Message ID random128 в E2EE header; server idempotency tag scoped к queue, не глобальный cross-queue ID. Order логический, не wall clock; bounded skipped keys и fragment windows. Неизвестные версии/oversize/invalid tag — bounded reject без panic. Статусы UI: «локально», «принято входом» (не delivery), «durable queue получателя» (заявление сервера), «расшифровано устройством» (только E2EE receipt); read receipt отдельный opt-in. Нельзя доказать удаление/чтение человеком.

Backup restore: абсолютная anti-rollback защита без внешнего monotonic witness/secure counter невозможна на всех платформах. Поэтому **никогда не экспортировать live ratchet/prekeys/pairwise IPC keys**. Экспорт — история/вложения/публичные контакты, после импорта новая device identity/новые queue keys, send blocked до re-pair. Старый filesystem snapshot AFU может откатить DB: hardware-bound install epoch/checkpoint вне контейнера и peer epoch detect помогают, но не универсальный counter. После подозрения rollback lock/rekey, не продолжение старых nonce. Удалить app data/переустановить — новая identity, не восстановление старой.

Watchdog: screen lock, background 30s (настраиваемо только строже), idle60s → revoke decrypt handles, cancel codec jobs, zeroize secrets/buffers, close DB, drop wrap handles. Заблокированный vault принимает только opaque ciphertext с лимитами. USB на locked — best-effort OS event усиливает lock; Android не гарантирует событие для всех кабелей/типов USB, поэтому USB detector не основа защиты. Keystore auth timeout0/короткий срок, biometric invalidation обрабатывается, приложение не зависает навсегда с ключами в RAM. Managed String/IME/codec copies и уже ушедший FD отозвать надёжно нельзя.

## 3. Матрица платформ и модулей

|Ось|Android APK (MVP)|CachyOS KDE Wayland/X11|Windows10/11|
|---|---|---|---|
|1 Hardware keys|CE storage, Keystore AES wrap KEK, StrongBox при поддержке, TEE fallback с видимым классом; getSecurityLevel; auth required; не считать X25519/ML-KEM hardware-supported|Secret Service/KWallet unlocked-session secret не аппаратная граница; optional TPM2 sealed KEK с PCR/update recovery policy; strong local passphrase|CNG Microsoft Platform Crypto Provider/TPM+Hello wraps KEK; DPAPI user scope дополнительно; same-user malware может вызвать unprotect|
|2 Background|UnifiedPush empty wake preferred; WorkManager best effort; foreground только user-visible допустимая задача; Android15 dataSync budget не unlimited|user systemd unit optional, lock closes vault, opaque network remains; inhibitors не обходят power policy|user process/tray; optional scheduled user startup, не привилегированный сервис без нужды; sleep/resume reconnection|
|3 Screen/input|FLAG_SECURE и recents, obscured touch reject, HIDE_OVERLAY_WINDOWS где API доступен; Accessibility warning; IME_FLAG_NO_PERSONALIZED_LEARNING рекомендация не запрет IME; sensitive clipboard15s|Wayland лучше изоляция, screenshot portal требует user consent но compositor привилегирован; X11 другой клиент читает экран/ввод, предупреждение high-risk; notification daemon history нельзя надёжно очистить|WDA_EXCLUDEFROMCAPTURE (Win10 2004+) capability test; older fallback не равно exclude; ввод/экран доступны malware/камере|
|4 Disk/RAM|allowBackup=false + backup/data extraction exclusions cloud+device-transfer, тест OEM; no external cleartext/temp/logs; no plaintext notifications; no debug dumps|RLIMIT_CORE0, prctl dumpable0, mlock/MADV_DONTDUMP с проверкой ошибок; encrypted swap/hibernate; btrfs NOCOW до создания, исключить snapshots; crypto erase, не SSD overwrite|VirtualLock best effort, WER app dump policy/no sensitive telemetry; BitLocker для pagefile/hiberfil; DPAPI не шифрует всё; исключить index/recent/JumpLists/thumbcache, VSS snapshots требуют crypto erase|
|5 IPC|signature permission + runtime UID/package/cert verification обоих концов; bound explicit Service/AIDL, PFD stream, без shared UID|UDS0600 private runtime dir0700, SO_PEERCRED+installation manifest; same UID не даёт сильной app isolation, Flatpak permissions/portals|Named Pipe DACL user SID, reject remote clients, peer token/PID verification, signed install manifests; same-user injection — предел, MSIX/AppContainer где возможно|
|6 Updates|offline APK signer+TUF trusted root, v2/v3 verify, v4 optional incremental; PackageInstaller user consent; no silent unknown source install|Flatpak signed OSTree remote + pinned refs/TUF policy, AUR PKGBUILD source hashes+подписи, AppImage detached manifest; baseline x86-64|Authenticode timestamp+TUF/hash, MSIX preferred; SmartScreen reputation/AV not bypassed, корпоративный proxy не повод отключить TLS|

Desktop lock не равен аппаратному BFU Android. Установка signed binary не мешает процессу того же UID внедряться, подменять библиотеки/конфиг, читать разрешённые files. `SO_PEERCRED` показывает UID/PID, не разработчика; проверка /proc/PID/exe хрупка к TOCTOU, interpreted scripts, plugins. Запрещены плагины/неподписанные dynamic modules SDK bus; для высокой уверенности нужен OS sandbox/изолированный пользователь и package validation, а root/администратор вне защиты.

### 3.1 Workspace blueprint (создаётся на этапе реализации)
```
crates/types              bounded IDs, typed secrets, versioned errors
crates/crypto-adapter     pinned libsignal; no algorithm reimplementation
crates/session           device/contact FSM, receipts, replay, linking hooks
crates/store             SQLCipher transactions, immutable encrypted outbox
crates/blob              per-file random keys, AEAD cells, encrypted manifests
crates/queue             quotas, TTL, migration, admission capabilities
crates/transport         opaque cells, route policy, retries, OS HTTP trait
crates/ecosystem-sdk     envelope, local pairing, grants, stream verifier
crates/update            TUF client, rollback floor, signing identity policy
crates/platform-api      KeyProtector/Clock/Net/LockEvents/Notification/Media/IPC
crates/ffi               UniFFI async commands, opaque handles, cancellation
apps/android             Kotlin/Compose + minimal AIDL/Keystore adapter
apps/linux               thin Rust+Qt6/QML or audited native UI; Wayland-first
apps/windows             WinUI3/C# + UniFFI C ABI bridge; no web remote content
services/ingress          opaque forwarder; no queue keys
services/queue            authenticated gateway + ciphertext durable queue
```
UniFFI Kotlin mature binding preferred; C#/Qt binding support requires prototype and audited memory ownership, не обещать генератор любой версии. Тонкая UI-оболочка не значит секреты через JSON. Traits: `protect/unprotect(key_ref, auth_policy)`, `send(route,opaque,deadline)`, `subscribe_lock`, `secure_display_status`, `open_verified_peer`, `install_verified_update`; errors различают Locked/Unsupported/PermissionDenied/IdentityChanged/PrivacyConsentRequired. Core никогда сам не снимает OS protection при ошибке. baseline CPU без `target-cpu=native`; runtime dispatched SIMD, локальная opt-in сборка `native` отдельно.

### 3.2 Путь plaintext и storage
SQLCipher community (pinned SQLite/OpenSSL, HMAC integrity, encrypted WAL/temp policy) + отдельно AEAD encrypted chunks; thumbnails в контейнере. Ключ БД случайный256, wrapping KEK аппаратный+при необходимости Argon2id user factor с калибровкой памяти (например 64MiB/250–750ms как эксперимент на слабом устройстве). PIN без hardware retry limiting не заменяет сильный пароль. SQLite temp_store=MEMORY, no plaintext FTS external index, WAL checkpoints/backup policy проверять. Ciphertext backups и OS snapshots не удаляются простым DELETE.

Файл: random256 file key, random128 file_id, derive per-file nonce-prefix/key domain, seq64 + unique per-key nonce; AEAD AAD включает file_id,total_chunks,index,length,codec policy hash. Манифест E2EE содержит hash/размер/порядок всех chunks или Merkle root; проверить каждый chunk до декодера, final root до публикации полного файла. Нельзя перемешать chunks двух файлов, укоротить файл или повторно использовать file key после resume с другим plaintext. Retry — тот же immutable chunk, изменение файла → новый file_id/key. Plain source→изолированный decoder RAM→raw frames/PCM→единый encoder profile→encrypted chunks; не держать 100MB RAM, bounded streaming и backpressure.

Стерилизация: декодировать, orientation/color преобразовать в pixels, discard EXIF/GPS/XMP/ICC comments/container tags/старые quantization tables; заново encode фиксированным профилем. Сам новый encoder создаёт quantization/codec headers — они не отсутствуют, а не переносятся с камеры. Video/audio timestamps normalise, strip chapters/device metadata; duration, voices, faces/background остаются. PRNU resize/noise экспериментальный opt-in, не доказанная деидентификация. Высокий риск decoder bugs: sandbox worker без network/storage, лимиты pixels/duration/ratio/CPU, patched codecs; hardware codec может иметь закрытые copies/buffers — не обещать очищение всей RAM. Невозможность стерилизации → отказ, не «отправить оригинал» автоматически. Опция original только отдельный будущий режим с явным предупреждением.

Clipboard: sensitive flag Android13, clear15s/background только если текущий clip всё ещё принадлежит приложению, иначе не стирать чужой; у клавиатуры/clipboard manager копия могла остаться. Notifications всегда generic, VISIBILITY_SECRET и no plaintext body на всех платформах. No link previews (ни server-side автоматических), no clickable remote images; явное открытие внешнего URL сообщает о выходе из защищённого контекста. Карты без сети/тайлов/геокодинга; live geo explicit duration default15min, precision choice, hard stop локальным monotonic timer; TTL не удаляет screenshot у peer. GPX парсер отключает XML entities/DTD, лимиты точек/строк, strip names/device/time по выбранной политике.

### 3.3 Двойной PIN, hidden volume и backup
|Вариант|Плюс|Риск/решение|
|---|---|---|
|SQLCipher+chunk store|зрелый storage, atomicity, sparse use|file sizes/times visible; MVP|
|фиксированный random-filled monolith|скрывает внутреннюю заполненность в одном snapshot|сложный WAL/allocator/wear, OS traces, snapshot diffs, RAM; нет доказанного plausible deniability; исследовательский модуль, не MVP|
|витринный/основной PIN|может показать ограниченный профиль|размер/история/поведение разоблачают; риск принуждения, не рекламировать как гарантию|
|Duress PIN|best effort забыть KEK handles/удалить wraps|ошибка/принуждение/старый backup; необратимо, не гарантирован hardware erase; не MVP|
|без backup|минимум копий|потеря телефона=потеря истории; default|
|локальный encrypted export|контроль носителя, независимый recovery key|копия бессрочна; random256 recovery key offline, authenticated manifest, без live sessions; MVP optional после restore tests|
|E2EE cloud backup+mnemonic|доступность истории|password guessing/rollback/metadata; mnemonic кодирует случайную энтропию, не пользовательскую фразу; phase2, не Dropbox по умолчанию|

btrfs `chattr +C` **не** исключает snapshots и не очищает старые extents; только до создания файлов, без обещания secure deletion. Отдельный subvolume вне Snapper + encrypted disk уменьшает следы, per-generation KEK destruction нужно и для SSD/VSS. Если wraps остались в backup, crypto-shred не состоялся. На Windows app не может универсально запретить admin VSS/дампы/pagefile; контролируем политику и честно показываем coverage.

## 4. Потоки данных и границы доверия
`[P]` — plaintext в RAM, `[S]` secret RAM, `|` — граница.

1. **Контакт:** Android UI[P invitation/SAS] → core[S ephemeral/device private] | OS QR/verified link (bearer secret не логировать) → ingress[opaque] | gateway[P rendezvous capability, не identity private] → peer core[S handshake, P SAS] → независимая сверка → durable verified state. Перехват QR без независимой сверки не исключён.
2. **Текст:** IME[P, вне доверия] → Compose[P] | core[P text,S chain key] → atomic encrypted outbox → OS HTTP[opaque] | CF[P outer HTTP/IP,opaque body] → VPS[P queue command,opaque content] → recipient transaction[S decrypt,P message] → UI[P]. Delivery/read receipts только тем же E2EE маршрутом. OS/root endpoint видит plaintext.
3. **Видео:** Gallery vault[S key,P decoded source] → sandbox[P bounded frames/PCM] → sterile encoder[P] → Gallery SDK[S pair key, encrypted PFD] | Messenger SDK[S pair key,P sterile stream transient] → blob encryptor[S file key] → encrypted disk chunks → CF→VPS→peer ciphertext → sandbox decode[P preview] → encrypted thumbnail storage. Не обещать нулевые копии: kernel pipe/codec buffers существуют; no plaintext filesystem.
4. **Гео:** Maps vault[P coordinates/track] → grant-scoped EcoEnvelope encrypted IPC | Messenger core[P chosen precision/expiry] → E2EE16KiB → peer[P coordinate] → explicit Maps grant/encrypted IPC → offline render[P pixels]. Gallery→Maps передаёт только выбранные local geotags, grant не даёт сканировать весь альбом. Network sanitizer для Messenger безусловно вырезает эти tags.
5. **Потеря/утечка очереди:** уцелевшее ранее привязанное устройство/контакт[P revoke request,S delegated authorization] → signed pairwise epoch/revoke → queue delete/rotate → peer block old device. Если ничего не осталось, нет магического удалённого wipe; новый QR/OOB, старое устройство остаётся угрозой до осведомления контактов. Queue capability leak не расшифровывает контент, но читает/засоряет ciphertext и timing.
6. **Shutdown:** уже committed ciphertext outbox → offline bundle (capsules version/length/random transport IDs, bounded size) | USB/чужой канал/LAN → peer verifier/dedup → core[S ratchet,P delivered]. Recipient key/fragment metadata остаются внутри E2EE. Relay-specific OHTTP ciphertext не самодостаточное сообщение: transport bundle переносит внутренний E2EE объект с pairwise rendezvous tag, не server bearer read/admin tokens. Возобновление сети dedup одинаковый message ID. **Update:** GitHub/Dropbox/CF/P2P[untrusted artifact] → TUF verifier[public root] → exact hash+APK signer check → PackageInstaller (user confirmation). Никакой обновляющий маршрут не изменяет identity trust автоматически.

## 5. Независимый Red Team
Полный реестр и блокеры: [RED_TEAM.md](RED_TEAM.md). Главные выводы: исходное требование скрыть routing от любого CF deployment неверно в варианте B; двухузловая low-latency схема не выдерживает сговор глобального наблюдателя; классический OHTTP нарушает PQ metadata цель; desktop peer credentials недостаточны; непрерывный FGS на Android15 нельзя обещать. Эти противоречия не устраняются интерфейсной надписью «защищено».

## 6. Приёмка и производительность
Полная измеримая матрица: [ACCEPTANCE.md](ACCEPTANCE.md). Все SLO ниже **[E] целевые**, не результаты.

|Метрика|Условия|Цель|
|---|---|---|
|Cold start+vault open|Android arm64 4GB RAM/UFS, 10k сообщений; после user auth, KDF отдельно|p50≤800ms,p95≤1500ms; KDF≤750ms целевой|
|Текст16KiB end-to-end commit|оба unlocked/active, 2 hops, каждый RTT≤50ms, ≥10Mbps, без loss|p50≤500ms,p95≤1500ms,p99≤3000ms, 10k samples|
|Выход из авиарежима|active app, валидная сеть, ≤100 pending text cells|first≤3s p95, drain≤10s; locked background только режимный SLO|
|Preview|authenticated first image/video preview ≤256KiB, 10Mbps|p95≤2s после первого authenticated fragment, без decode incomplete raw chunk|
|100MiB video|sterilized output already ready, 10Mbps bottleneck,2 hops RTT50ms|≥6Mbps goodput; ≤150s целевой; encode отдельно ≤2x realtime на baseline, иначе progress/cancel|
|Background24h|screen off, stable LTE/Wi-Fi раздельно, 0 и 100 сообщений, push vs poll|добавочный drain≤3 процентных пункта ёмкости/сутки (и отчёт mAh/Wh), polling target≤20MiB/day; не blanket guarantee|
|Память/диск|2GB RAM budget phone,100MiB video,low disk|core RSS≤96MiB без codec, bounded codec≤256MiB целевой; no plaintext temp; ENOSPC atomic fail|

16KiB cell vs 200B text =81.92x до crypto/HTTP overhead; ≠ бесплатная privacy. 100MiB/полезная ёмкость cell >6400 cells; outer/inner headers уменьшают capacity, exact formula в acceptance. Активный cover: max1 dummy/4 real cells, jitter0–150ms, batch windows≤250ms, disabled background by default. Один poll request+response16KiB каждые15min уже 3MiB/day без HTTP; каждые5min≈9MiB; радиомодем tail energy доминирует. No round-the-clock noise. Пауза cover при low battery/data saver показывает «снижен шум», но не отключает E2EE.

Приоритет scheduler: control/rekey=0,text/geo=1,preview=2,media=3,cover=4; weighted fairness (media минимум10% при непрерывном тексте), preemption на границе cell, max4 media in-flight, text reserved slot. Backoff full jitter min1s,max5min, retry budgets, Retry-After bounded, per-host circuit breaker; новые transport keys не contact identities. Wi-Fi↔4G пересоздаёт HTTP и resume ciphertext chunks; не пересоздаёт E2EE для retry. Loss20% TCP даёт HOL, уменьшаем parallelism, QUIC где доступен, без изменения crypto. Captive portal — offline queue/explicit OS portal, не accept-any-cert. Clock skew — readable diagnostic, local editing и очередь работают, update/contact config expiry fail-closed до trusted time/OOB, не отключать signature/expiry.

### 6.1 Деградация
|Событие|Локальная история/очередь/IPC|Приём/новые контакты/updates|Уведомление|
|---|---|---|---|
|один ingress down|работают при unlocked vault|сменить заранее подписанный ingress той же privacy class; handshake сохраняет peer identity|route changed; increased metadata требует consent|
|CF/domain blocked|работают|независимый C вход/заранее bootstrap config; если нет — offline; updates из проверенного файла|нет связи, не «доставлено»|
|whitelist network|работают|только если разрешён endpoint/proxy; никаких гарантий обхода; OOB QR локально|ограниченная сеть|
|месяц offline|история/новая локальная очередь работают; TTL истекает на relay|новый handshake/queue rebind после возвращения с проверкой identity; expired cells могут потеряться; signed file update проверяется по policy|пробел истории/истекшая доставка|
|полный shutdown|история/создание сообщений/Gallery/Maps работают|MVP только file import/export; LAN/mesh phase2; QR offline contact допустим; APK вручную с полной проверкой|«Интернет недоступен; файл не означает получение»|

TTL30d не обещает месяц offline плюс произвольную доставку. Pending sender outbox хранит ciphertext до user TTL/ACK, показывает expiry и предлагает осознанный resend с **новым** message ID только если это новое пользовательское сообщение, иначе retry исходного.

## 7. Дорожная карта

**А: обязательно до v1.0 Android:** freeze crypto+suites и license decision; hardware wrapping/lock; 1:1 SAS/device keys; independent ingress+queue и fallback C; fixed bodies; atomic outbox/rollback-safe restore; sterile image/video/audio pipeline+encrypted blobs; scoped Eco IPC для Gallery/Maps, offline geo; generic notifications; UnifiedPush plus honest scheduled polling; file bundles; TUF/APK verification; fuzz/property/crash tests, external audit и реальные OEM battery trials. Качество важнее ярлыка «MVP»: пока B-NET-PQ открыт, публичного production v1 нет.

**Б: phase2 после измерений:** CachyOS сначала, Windows затем; user systemd/tray; QR multi-device encrypted block sync с per-device sessions; MLS groups с отдельным PQ design; relay-only calls; LAN/Wi-FiDirect/BLE mesh; cloud history backup; эксперимент cover/PRNU; optional privacy leak transports только consent.

**В: отклонить/не включать без пользы:** общие hardcoded secrets, webviews remote JS, auto link previews, сканер адресной книги, background live-location по умолчанию, bare STUN/ICE P2P, нестандартные TLS fingerprints, root-hide/Accessibility abuse, duress/hidden volumes с маркетингом абсолютной неотличимости, самописный ratchet/PQ combiner, бесконечный FGS workaround, постоянный шум ради красивого графика, протоколы/кодеки без sandbox.

### 7.1 Phase2 интерфейсы сейчас
`DeviceLink`, `GroupEpoch`, `CallTransport`, `LocalCarrier` только typed boundaries, не заглушки «успешно». Linking QR содержит одноразовый capability+ephemeral key, authenticated handshake и SAS в локальной сети; каждый device генерирует собственные keys, получает подписанные pairwise delegated certs, история передаётся opt-in E2EE blocks, не копируется DB/ratchet. No global cloud account; Android не «единственный навсегда root». Предварительно связанное устройство может отозвать peer по policy/threshold; без него потеря требует OOB.

MLS: новые участники не получают старые epochs автоматически, удалённые не получают новые после commit; старые скачанные сообщения не стираются; offline member/rollback/rejoin tests. MLS RFC9420 не решает transport anonymity или PQ без допрофиля. Calls: TURN-only/собственные forwarding relays, запрет host/srflx candidates и direct fallback, DTLS-SRTP alone не автоматически E2EE через mixer; SFrame RFC9605/эквивалент с audited group keys; fixed **малые realtime packets** и bounded frames, не навязывать 16KiB voice packet, иначе latency/bandwidth неприемлемы. Это отдельный versioned transport profile; size/time still disclose calls. Нагрузка/packet-loss/congestion и батарея до включения.

LAN: mDNS по умолчанию off, только user discovery window, случайный service instance без app/device/contact IDs, rotating HMAC rendezvous tags под shared discovery key, LAN наблюдатель всё равно видит presence/MAC/IP. Wi-Fi Direct/BLE permissions/platform restrictions, адресная рандомизация не анонимность. Store-carry-forward bounded TTL/hops/storage, no epidemic broadcast of identifiable contact graph. Файловые bundles не содержат decrypt keys/read/admin queue caps; имя random, no exported plaintext thumbnail, импорт всегда недоверенный.

## 8. Памятка пользователю и организация

**Простыми словами:** зелёная проверка означает «ключ контакта проверен», а не «за вами никто не наблюдает». Входной узел видит ваш IP; сеть видит время и объём. При смене ключа отправка остановится — свяжитесь с человеком другим способом. Собеседник может сохранить всё. Утерянное устройство нельзя гарантированно стереть удалённо. Без резервной копии история потеряется; восстановление истории требует нового связывания. «Принято сервером» ещё не значит «получено человеком». Если fallback раскрывает IP, приложение спросит до соединения.

Android: сильный системный пароль, обновления ОС, аппаратный Keystore лучше, но unlocked/root не защищены; OEM может задержать сообщения; UnifiedPush видит wake timing. FGS notification не означает гарантированную круглосуточную доставку. Не вводите PIN в подозрительную клавиатуру, Accessibility warning проверьте вручную. CachyOS: выбирайте Wayland, шифруйте диск/swap/hibernate, исключите vault из Snapper, X11 заметно слабее; KWallet открытому сеансу не root-proof. Windows: BitLocker/Hello/TPM и обновлённая ОС; DPAPI/окно capture exclusion не остановят malware вашего пользователя; Windows10 требует поддерживаемого security servicing (ESU/LTSC где применимо), unsupported build — предупреждение/политика поддержки.

Структура GitHub, Dropbox, подпись и пошаговый план — [IMPLEMENTATION.md](IMPLEMENTATION.md). GitHub source of truth для versioned standards, Dropbox — копия утверждённой документации/синтетических артефактов с commit/hash, не альтернативный mutable протокол. Ни `.jks/.keystore`, ни приватный TUF root/APK key, Cloudflare token, пароли, production DB и настоящие traces туда не попадают. Подключённый AI не получает секрет даже для «помощи с подписью».

## 9. Готовый стандарт интеграции

Полный отдельный копируемый файл в корне: [AI_ECOSYSTEM_HANDOFF_GUIDE.md](../AI_ECOSYSTEM_HANDOFF_GUIDE.md). Он нормативен для local IPC, включает константы/формат/nonce/права/API/потоки/промпт и запреты. Нельзя заменять его одним общим «ключом интеграции». Это public specification, не секрет. Совместимость подтверждается общей test suite, а не заявлением другого ИИ.
