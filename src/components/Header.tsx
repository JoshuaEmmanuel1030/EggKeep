import { Egg, Download, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { LanguageToggle } from "@/components/LanguageToggle";
import { InstallButton } from "@/components/InstallButton";
import { useLanguage } from "@/contexts/LanguageContext";

interface HeaderProps {
  onExport: () => void;
}

export function Header({ onExport }: HeaderProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleLogout = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <header className="border-b bg-card shadow-soft sticky top-0 z-50">
      <div className="container flex items-center justify-between h-16 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center shadow-sm">
            <Egg className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg leading-tight">JS Online</h1>
            <p className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-none">
              {user?.email || t.header.inventoryTracker}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onExport} className="gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-3">
            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">{t.header.exportCsv}</span>
          </Button>
          <InstallButton />
          <LanguageToggle />
          <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1.5 sm:gap-2 h-8 sm:h-9 px-2 sm:px-3">
            <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">{t.header.logout}</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
