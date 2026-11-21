# Источники, лицензии и степень проверки

Дата проверки: 2026-11-20. Доступ сети рабочего окружения ограничен GitHub/npm/PyPI; официальные сайты Android/Microsoft/RFC не загружались. Ссылки ниже — первичные нормативные документы для реализации, а не утверждение, что каждая текущая страница проверена live. Перед freeze сверить актуальную редакцию и сохранить permalink/hash в evidence. Приведённые SLO/цены/anti-DPI/батарея — не доказанные свойства.

## Проверено через GitHub API в этой сессии

- [signalapp/libsignal](https://github.com/signalapp/libsignal), license API сообщает AGPL-3.0. Просмотрен README: стороннее использование unsupported, API может изменяться. HEAD main на момент запроса `aec3c6cc172c43e7fdde3f0e21f466d8e58a23c0`; это **reference snapshot, не автоматически approved dependency pin**. В `rust/protocol/src` существуют `pqxdh.rs`, `double_ratchet.rs`, `triple_ratchet.rs`, `tahini.rs`, `kem/`. Наличие файлов не подтверждает выбранный wire suite/аудит конкретной версии.
- [openmls/openmls](https://github.com/openmls/openmls), license API MIT. Проверять конкретный tag/crypto provider/deps.
- [cloudflare/odoh-rs](https://github.com/cloudflare/odoh-rs), BSD-2-Clause; **ODoH RFC9230 не OHTTP RFC9458**. Не выбирать библиотеку только по похожему имени. Для OHTTP возможен [martinthomson/ohttp](https://github.com/martinthomson/ohttp) как кандидат, лицензия/аудит/версия здесь не подтверждены и требуют проверки.
- [Cloudflare Workers limits source](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/platform/limits.mdx) получен через Contents API. Проверены plan-dependent body limits, memory128MB, CPU/free requests и раздел runtime updates. Динамические тарифы/продуктовые таймауты требуют release-time проверки. Нельзя из этого файла вывести единый WS idle timeout всех продуктов.

## Протоколы и криптография (нормативные ссылки)
- [Signal specs](https://signal.org/docs/): X3DH/PQXDH, Double Ratchet/Triple Ratchet — exact version audit gate. PQXDH не автоматически continuous PQ PCS.
- [RFC9180 HPKE](https://www.rfc-editor.org/rfc/rfc9180), [RFC9458 OHTTP](https://www.rfc-editor.org/rfc/rfc9458), [RFC5869 HKDF](https://www.rfc-editor.org/rfc/rfc5869), [RFC8439 ChaCha20-Poly1305](https://www.rfc-editor.org/rfc/rfc8439).
- [RFC9420 MLS](https://www.rfc-editor.org/rfc/rfc9420), [RFC9605 SFrame](https://www.rfc-editor.org/rfc/rfc9605), [RFC8949 CBOR](https://www.rfc-editor.org/rfc/rfc8949), [RFC8484 DoH](https://www.rfc-editor.org/rfc/rfc8484).
- NIST FIPS203 ML-KEM; X25519 RFC7748; Ed25519 RFC8032; [Noise specification](https://noiseprotocol.org/noise.html). Ни один из этих документов сам по себе не стандартизует наш hybrid routing profile; это открытый blocker.
- [TUF specification](https://theupdateframework.github.io/specification/latest/). Root/targets/snapshot/timestamp, threshold, expiry, version rollback. Не путать TUF с APK signer или одним update.json.

## Android первичные API
- [Keystore](https://developer.android.com/privacy-and-security/keystore), KeyInfo.securityLevel/isInsideSecureHardware по API; StrongBox KeyGenParameterSpec, setUserAuthenticationRequired, KeyPermanentlyInvalidatedException.
- [Backup](https://developer.android.com/identity/data/autobackup): allowBackup, fullBackupContent, dataExtractionRules (cloud-backup/device-transfer), OEM differences проверяются на устройстве.
- [Android15 FGS timeout](https://developer.android.com/develop/background-work/services/fgs/timeout): dataSync/mediaProcessing limits, Service.onTimeout; [service types](https://developer.android.com/develop/background-work/services/fgs/service-types). Не игнорировать targetSdk/OS version.
- WindowManager.LayoutParams.FLAG_SECURE; View.filterTouchesWhenObscured; MotionEvent.FLAG_WINDOW_IS_OBSCURED/PARTIALLY_OBSCURED; HIDE_OVERLAY_WINDOWS where supported; EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING; ClipDescription.EXTRA_IS_SENSITIVE; Notification.VISIBILITY_SECRET.
- Binder.getCallingUid, PackageManager.GET_SIGNING_CERTIFICATES, SigningInfo, Context.bindService, explicit ComponentName, ParcelFileDescriptor; PackageInstaller; [apksig source](https://github.com/JetBrains/android/tree/master/tools/apksig) — использовать актуальный Android build-tools upstream, этот mirror не source pin.
- APK signature v2/v3/v3.1 и v4: [AOSP signing](https://source.android.com/docs/security/features/apksigning).
- [UnifiedPush specifications](https://unifiedpush.org/developers/spec/). Empty wake ещё раскрывает timing.

## Linux/Windows
- Linux man pages: unix(7) SO_PEERCRED, prctl(2) PR_SET_DUMPABLE, setrlimit(2), mlock(2), madvise(2) MADV_DONTDUMP. Проверить разрешения/лимиты и return codes.
- btrfs documentation: NOCOW/chattr +C, subvolumes/snapshots; NOCOW не равно snapshot exclusion/secure erase. Secret Service spec; TPM2 sealing policy and system updates.
- Microsoft Learn: [DPAPI](https://learn.microsoft.com/windows/win32/secauthn/data-protection), CNG Platform Crypto Provider/TPM, Windows Hello; [SetWindowDisplayAffinity](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity), WDA_EXCLUDEFROMCAPTURE начиная Win10 2004 с ограничениями; named pipe client impersonation/DACL/PIPE_REJECT_REMOTE_CLIENTS; WER local dumps, VirtualLock, Authenticode/WinVerifyTrust.

## Кандидаты зависимостей, не blanket audit claim
`zeroize`, `secrecy`, `uniffi`, `rusqlite`, SQLCipher Community, `tokio`, `snow`, RustCrypto AEAD/HKDF/ML-KEM реализации: выбирать точные версии после threat/API prototype, сохранять Cargo.lock/SPDX, проверять advisories и аудит **конкретной сборки**. MIT/Apache primitive implementation ≠ audited compositional protocol. Не подставлять искусственные version pins ради вида готового проекта.
