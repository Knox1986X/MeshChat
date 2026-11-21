# MeshChat — security engineering baseline

Инженерный пакет и начало реализации от 2026-11-20. **Это не готовый защищённый мессенджер и не аудированная реализация.** В GitHub Actions собран только LAB APK для временного аппаратного wrap/unwrap и Rust SQLCipher lifecycle теста: [ссылка, SHA256 и фактические проверки](docs/PROGRESS.md). Старое рабочее дерево удалено по запросу владельца; история Git сохранена.

## Текущее состояние реализации
- `crates/eco-envelope` — Rust-парсер/кодировщик строго ограниченного заголовка, без криптографии и без выделения памяти при разборе конверта. Все результаты явно `Untrusted`.
- `crates/session-policy` — политика доверия контакту: блокировка непроверенного/изменённого ключа, защита от устаревшего результата UI-проверки, терминальный revoke, запрет возобновления сессии из истории. Это ещё не криптосессия и не разрешение отправки.
- `crates/transport-policy` — проверка privacy prerequisite: IP-exposure consent с привязкой к маршруту/config, expiry/clock checks, запрет обхода обязательного SOCKS. [Контракт](docs/TRANSPORT_POLICY.md).
- `crates/store` — SQLCipher + Zeroizing: атомарное сохранение следующего состояния ратчета и неизменяемой исходящей ячейки, revision/CAS, quotas, bounded retry batches и process-death tests. Подключение к Android только в LAB проверено native CI и AOSP-эмулятором; E2EE, snapshot rollback и forensic FS не решены. [Контракт и ограничения](docs/STORE.md).
- `crates/vault` / `crates/ffi` — revocable lifecycle Locked/Unlocking/Unlocked/Closed, одноразовые generation-bound tickets и узкий UniFFI API. Rust tests/clippy, Android native build и8 instrumented tests на AOSP-эмуляторе прошли. Lock закрывает опубликованную БД и запрещает публикацию позднего unlock, но не гарантирует мгновенное стирание всех копий RAM.
- `apps/android` — отдельная Kotlin/Compose LAB-оболочка без сети, личных данных и IPC. Hardware-only AES-GCM wrapping подключён к явному временному тесту через системную биометрию: без автоматического TEE/software fallback, с отменой на pause/screen-off/timeout. На реальном устройстве ещё не проверен. [Контракт и ограничения](docs/KEY_PROTECTOR.md). Release variant отключён. [Сборочные требования и ограничения](apps/android/README.md).
- Диагностика для тестирования: просмотр/очистка и ручной экспорт `.txt`,256 allowlisted событий в RAM, без ключей/личных данных/автоотправки. [Инструкция тестировщику](docs/BETA_TESTING.md). Это ещё не бета готового мессенджера.
- [Фактический статус, свежий APK и результаты проверок](docs/PROGRESS.md).

Команды: сначала `cargo fetch --locked`, затем `cargo test --workspace --locked --offline` и `cargo clippy --workspace --all-targets --locked --offline -- -D warnings`. SQLCipher/OpenSSL собираются из закреплённых в Cargo.lock исходников; нужны C compiler и build tools. В локальной Arena-среде Rust/JDK/Android SDK отсутствуют, но реальная компиляция выполнена в GitHub Actions: Rust workspace6 crates tests/clippy, Kotlin compile, 9 JVM tests, Android lint и debug APK build прошли. 11 Python-тестов прошли локально и в CI. 8 instrumented tests реально выполнены на AOSP API30 x86_64; StrongBox/биометрия/поведение на телефоне ещё не проверены. Подробное evidence и ограничения — в `docs/PROGRESS.md`.

## Читать в таком порядке
1. [Архитектура и все девять разделов задания](docs/ARCHITECTURE.md)
2. [Самодостаточный стандарт интеграции для будущих ИИ](AI_ECOSYSTEM_HANDOFF_GUIDE.md)
3. [Red Team / release blockers](docs/RED_TEAM.md)
4. [Приёмка и измерения](docs/ACCEPTANCE.md)
5. [План реализации и эксплуатация](docs/IMPLEMENTATION.md)
6. [Источники, лицензии, степень уверенности](docs/SOURCES.md)

`specs/eco-envelope-v1.json` — машинные константы; `tools/eco_header.py` — только эталон кодирования заголовка (НЕ крипто-SDK). `python3 -m unittest discover -s tests -v` проверяет синтаксис, границы и отрицательные случаи. Эти тесты не доказывают безопасность системы.

Нормативные MUST/SHOULD/MAY применяются к будущей реализации. Статус протоколов: EcoEnvelope — draft v1 для межъязыкового прототипа; сетевой PQ-профиль — NOT FROZEN, релиз запрещён до независимой проверки. Публичные отпечатки и package IDs ещё требуют утверждения владельцем; отсутствующее значение означает отказ, не доверие любому ключу.

Работа ведётся только в текущей ветке Arena. Никаких секретов, реальных пользовательских pcap, ключей подписи или production-конфигов в репозитории.
