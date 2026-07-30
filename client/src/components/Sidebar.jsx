import { LayoutDashboard, Camera, Bot, ChevronLeft, ChevronRight, Leaf } from 'lucide-react';

export default function Sidebar({ activeTab, onTabChange, isCollapsed, setIsCollapsed }) {
  const menuItems = [
    { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'camera', label: 'Camera & Sâu bệnh', icon: Camera },
    { id: 'chat', label: 'Trợ lý AI', icon: Bot },
  ];

  return (
    <aside
      className={`relative hidden md:flex flex-col h-full bg-white border-r border-slate-200 shadow-sm z-40 shrink-0 ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Floating Collapse Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3.5 bottom-8 w-7 h-7 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-300 shadow-sm z-50"
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Navigation Links */}
      <div className="flex-1 py-6 px-3 space-y-2 overflow-y-auto custom-scrollbar mt-2">
        {menuItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={isCollapsed ? item.label : ''}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl font-bold group ${
                isActive
                  ? 'bg-emerald-50 text-emerald-600 shadow-sm ring-1 ring-emerald-500/20'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-emerald-600' : 'text-slate-400 group-hover:text-emerald-500'}`} />
              {!isCollapsed && (
                <span className="text-sm whitespace-nowrap overflow-hidden">
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
