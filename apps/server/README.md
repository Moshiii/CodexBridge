# AutoAide Server

`apps/server` 目前不是 `AutoAide` 的主产品入口。

当前定位：

- 作为未来 web / channel / webhook 接入的占位 app
- 保留最小 HTTP 进程骨架和 `healthz` 能力
- 不参与当前 first-value 主链路

当前主链路是：

- `autoaide tui`

因此：

- 新功能默认不应优先加在这里
- 只有当某项能力明确属于 web 或 channel ingress 时，才应回到这个 app
- 如果只是为了验证 manager plane，应优先在 `apps/tui` 或 `apps/cli` 推进
