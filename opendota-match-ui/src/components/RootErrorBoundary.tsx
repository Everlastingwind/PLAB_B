import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { err: Error | null };

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[RootErrorBoundary]", err, info.componentStack);
  }

  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            maxWidth: 640,
            margin: "48px auto",
            color: "#111",
          }}
        >
          <h1 style={{ fontSize: 18, marginBottom: 12 }}>页面加载出错</h1>
          <pre
            style={{
              fontSize: 13,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#f5f5f5",
              padding: 12,
              border: "1px solid #ccc",
            }}
          >
            {this.state.err.message}
          </pre>
          <p style={{ fontSize: 13, marginTop: 16, color: "#444" }}>
            请打开浏览器开发者工具 (F12) → Console 查看完整堆栈。若与 Supabase
            相关，请检查仓库根目录 <code>.env.local</code> 是否为真实的 https://
            项目地址，保存后重启 <code>npm run dev</code>。
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
