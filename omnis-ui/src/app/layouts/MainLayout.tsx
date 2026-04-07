import { Outlet, Link, useLocation, useNavigate } from "react-router";
import { MessageSquare, Network, FileText, BarChart3, Settings, Bell, User, Search, Moon, Sun, ChevronLeft, ChevronRight, LogOut, ChevronDown } from "lucide-react";
import { useTheme } from "../components/ThemeProvider";
import { useState, useRef, useEffect } from "react";
import { useUpload } from "../context/UploadContext";


export default function MainLayout() {
  const location = useLocation();
  const navigate  = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen,     setUserMenuOpen]     = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [userMenuOpen]);

  const navItems = [
    { path: "/", label: "Chat", icon: MessageSquare },
    { path: "/graph", label: "Knowledge Graph", icon: Network },
    { path: "/documents", label: "Documents", icon: FileText },
    { path: "/evaluations", label: "Evaluations", icon: BarChart3 },
    { path: "/settings", label: "Settings", icon: Settings },
  ];

  const { uploadState } = useUpload();
  const isUploading = uploadState !== null &&
    uploadState.phase !== "complete" &&
    uploadState.phase !== "failed";

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* Top Nav Bar */}
      <header
        className="h-12 flex items-center justify-between px-6 sticky top-0 z-50 relative"
        style={{
          background: 'var(--surface)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)'
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)' }}>
          <div className="flex items-center gap-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="4" r="2" fill="var(--accent-teal)" />
              <circle cx="4" cy="14" r="2" fill="var(--accent-teal)" />
              <circle cx="16" cy="14" r="2" fill="var(--accent-teal)" />
              <line x1="10" y1="6" x2="5" y2="12" stroke="var(--accent-teal)" strokeWidth="1.5" />
              <line x1="10" y1="6" x2="15" y2="12" stroke="var(--accent-teal)" strokeWidth="1.5" />
              <line x1="6" y1="14" x2="14" y2="14" stroke="var(--accent-teal)" strokeWidth="1.5" />
            </svg>
          </div>
          <span style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600 }}>
            <span style={{ color: 'var(--accent-teal)' }}>Omnis</span>
          </span>
        </div>

        {/* Global Search — absolutely centred */}
        <div className="absolute left-1/2 -translate-x-1/2 w-[480px] max-w-[40vw]">
          <div
            className="relative w-full h-9 rounded-lg flex items-center px-4 gap-3 transition-all duration-200"
            style={{
              background: 'var(--elevated)',
              border: '1px solid var(--border)',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
            }}
          >
            <Search size={16} style={{ color: 'var(--accent-teal)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Ask anything or search your knowledge graph..."
              className="flex-1 bg-transparent border-0 outline-none placeholder:text-text-tertiary"
              style={{ color: 'var(--text-primary)', fontSize: '13px' }}
            />
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-4">
          <div
            className="px-2 py-1 rounded text-[11px]"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            $12.43 this month
          </div>
          <button
            onClick={toggleTheme}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            <Bell size={18} />
          </button>

          {/* User avatar + dropdown */}
          <div ref={userMenuRef} style={{ position: "relative" }}>
            <button
              onClick={() => setUserMenuOpen(v => !v)}
              className="flex items-center gap-1.5 transition-colors"
              style={{ color: userMenuOpen ? 'var(--text-primary)' : 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
              title="Account"
            >
              <User size={18} />
              <ChevronDown size={11} style={{ opacity: 0.7, transition: 'transform 150ms', transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
            </button>

            {userMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 10px)",
                  right: 0,
                  minWidth: "200px",
                  background: "var(--elevated)",
                  border: "0.5px solid var(--border)",
                  borderRadius: "10px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                  zIndex: 999,
                  overflow: "hidden",
                }}
              >
                {/* User info header */}
                <div
                  style={{
                    padding: "12px 14px 10px",
                    borderBottom: "0.5px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                      style={{
                        width: "30px",
                        height: "30px",
                        borderRadius: "50%",
                        background: "rgba(0,217,192,0.12)",
                        border: "0.5px solid var(--accent-teal)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <User size={14} style={{ color: "var(--accent-teal)" }} />
                    </div>
                    <div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "11.5px", color: "var(--text-primary)", fontWeight: 500 }}>
                        Ada Lovelace
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-tertiary)", marginTop: "1px" }}>
                        ada@company.com
                      </div>
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                <div style={{ padding: "6px" }}>
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate("/settings"); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                  >
                    <Settings size={13} />
                    Settings
                  </button>

                  {/* Divider */}
                  <div style={{ height: "0.5px", background: "var(--border)", margin: "4px 0" }} />

                  <button
                    onClick={() => { setUserMenuOpen(false); navigate("/auth/login"); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      color: "var(--danger)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,77,106,0.07)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
                  >
                    <LogOut size={13} />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside
          className="flex flex-col flex-shrink-0 transition-all duration-300"
          style={{
            width: sidebarCollapsed ? '52px' : '220px',
            background: 'var(--surface)',
            borderRight: '1px solid var(--border)'
          }}
        >
          <nav className="flex-1 p-2 space-y-1 overflow-hidden">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  title={sidebarCollapsed ? item.label : undefined}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 group relative"
                  style={{
                    background: active ? 'var(--elevated)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    justifyContent: sidebarCollapsed ? 'center' : undefined,
                  }}
                >
                  {active && (
                    <div
                      className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r"
                      style={{ background: 'var(--accent-teal)' }}
                    />
                  )}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <Icon size={16} />
                    {isUploading && item.path === "/documents" && (
                      <span
                        className="animate-pulse"
                        style={{
                          position: "absolute",
                          top: -3,
                          right: -3,
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: "var(--accent-teal)",
                          boxShadow: "0 0 4px var(--accent-teal)",
                          display: "block",
                        }}
                      />
                    )}
                  </div>
                  {!sidebarCollapsed && (
                    <span className="truncate flex-1">{item.label}</span>
                  )}
                  {!sidebarCollapsed && isUploading && item.path === "/documents" && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{
                        background: "rgba(0, 217, 192, 0.15)",
                        color: "var(--accent-teal)",
                        fontFamily: "var(--font-mono)",
                        border: "1px solid rgba(0, 217, 192, 0.3)",
                        flexShrink: 0,
                      }}
                    >
                      {uploadState!.totalPct}%
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Usage Meter — hidden when collapsed */}
          {!sidebarCollapsed && (
            <div
              className="p-4 m-3 rounded-lg"
              style={{ background: 'var(--elevated)', border: '1px solid var(--border)' }}
            >
              <div className="text-[11px] mb-2" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                TOKENS THIS MONTH
              </div>
              <div className="relative w-full h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--border)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ background: 'var(--accent-teal)', width: '68%' }}
                />
              </div>
              <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                <span>68M / 100M</span>
                <span>68%</span>
              </div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="flex items-center justify-center h-9 mx-2 mb-3 rounded-lg transition-colors"
            style={{ color: 'var(--text-tertiary)', background: 'var(--elevated)', border: '1px solid var(--border)' }}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}