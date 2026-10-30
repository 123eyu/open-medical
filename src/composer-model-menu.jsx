import { useEffect, useRef, useState } from "react";
import { ChevronDown, Settings2 } from "lucide-react";

// One control for the model the next message uses: the button shows the model
// (and whether deep thinking is on), and the menu opens right above it.
export function ComposerModelMenu({ config, thinking, onThinkingChange, onModelSettings, disabled }) {
  // The chat box scrolls, which would clip an absolutely positioned menu, so the
  // menu is fixed to the viewport and placed from the button's position.
  const [position, setPosition] = useState(null);
  const open = Boolean(position);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const setOpen = (next) => {
    if (!next) return setPosition(null);
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), bottom: window.innerHeight - rect.top + 8 });
  };
  const configured = Boolean(config?.modelConfigured);
  const thinkingOn = configured && thinking === "enabled";

  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const dismiss = () => setPosition(null);
    // The menu is fixed to the viewport, so any scroll would leave it behind.
    const onScroll = (event) => { if (!rootRef.current?.contains(event.target)) dismiss(); };
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <div
      className="composer-model"
      ref={rootRef}
      onKeyDown={(event) => {
        // Close only this menu; Escape must not also close the side panel.
        if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="composer-model-button"
        aria-haspopup="true"
        aria-expanded={open}
        title="切换模型与思考方式"
        onClick={() => setOpen(!open)}
      >
        <b>{configured ? config?.model || "未命名模型" : "未配置模型"}</b>
        {thinkingOn && <span className="composer-model-tag">深度思考</span>}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="composer-model-menu" role="group" aria-label="模型与思考方式" style={position}>
          <div className="composer-model-current">
            <span>当前模型</span>
            <b>{configured ? config?.model || "未命名模型" : "未配置"}</b>
          </div>
          <label className={`composer-model-row ${configured ? "" : "disabled"}`}>
            <span>
              <b>深度思考</b>
              <small>{configured ? "先推理再回答，更慢但更周全；取决于模型是否支持" : "配置模型后可开启"}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={thinkingOn}
              disabled={!configured || disabled}
              onChange={(event) => onThinkingChange(event.target.checked ? "enabled" : "disabled")}
            />
          </label>
          <button
            type="button"
            className="composer-model-row"
            onClick={() => { setOpen(false); onModelSettings(); }}
          >
            <span><b>{configured ? "切换或配置模型…" : "配置模型…"}</b></span>
            <Settings2 size={15} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
