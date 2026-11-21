# Transport privacy prerequisite

`meshchat-transport-policy` — dependency-free in-memory policy, не сетевой клиент
и не проверка подписей конфигурации. Она не меняет E2EE suites и не разрешает
никакой crypto fallback. Все поля Route должен предоставить authenticated config
adapter после подписи/floor/expiry checks; недоверенный JSON нельзя напрямую
превращать в Route и считать безопасным.

Режимы:
- SplitOperators: ingress/queue operator IDs должны быть ненулевые и различные.
  Это только конфигурационное условие, не доказательство независимости компаний
  и не защита от сговора/глобального наблюдателя.
- QueueSeesClientIp: до первого пакета нужно отдельное подтверждение.
- PeerSeesClientIp: то же; нельзя переносить согласие на direct server в P2P.

Consent одноразовый Rust value без Clone, связан со всей Route (ID, config binding,
exposure, оба operator IDs, expiry). TTL≤60s. Изменение конфигурации/экспозиции
обнуляет согласие, clock rollback/expiry/missing time блокируют попытку. Прокси
SocksRequired блокирует direct egress даже с согласием на раскрытие IP. Значение
`using_required_proxy` должен дать реальный platform adapter; пока такого adapter
нет и эти функции никого не подключают к сети.

Success `check_route_prerequisite` — только одно prerequisite, не send permit.
Настоящий транспорт должен повторно проверить lock/contact trust/config validity
и направлять **весь** egress через единый adapter. Consent нельзя хранить глобальным
bool, логировать, получать из remote config или автоматически создавать после retry.
Текущая строгая модель требует нового решения на новую повышающую exposure
попытку; session-scoped UX возможен только после отдельного versioned review.

Семь Rust-тестов покрывают нормальный split path, обе IP-exposure деградации,
одинакового/нулевого оператора, смену config/route/exposure, required proxy,
истечение/откат времени. Прошли в GitHub Actions вместе с workspace test/clippy;
ссылка на run/commit и границы в `PROGRESS.md`. Локально в Arena Rust отсутствует.
Это проверка модели, а не настоящей сети/подписанного config adapter.
