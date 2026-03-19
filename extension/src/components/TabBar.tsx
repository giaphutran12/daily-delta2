interface Tab {
  id: string;
  label: string;
}

const TABS: Tab[] = [
  { id: 'companies', label: 'Companies' },
  { id: 'runs', label: 'Active' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
];

interface TabBarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="flex border-b border-black/8 bg-white">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 py-2.5 text-[10px] font-medium uppercase tracking-widest transition-colors cursor-pointer ${
            activeTab === tab.id
              ? 'text-[#1342FF] border-b-2 border-[#1342FF] -mb-px'
              : 'text-black/35 hover:text-black/60'
          }`}
          style={{ fontFamily: "'Departure Mono', monospace" }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
