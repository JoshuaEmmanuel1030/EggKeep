import { useState } from "react";
import { Settings, RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InstallDialog } from "@/components/InstallDialog";
import { refreshApp } from "@/lib/pwaUpdate";
import { useLanguage } from "@/contexts/LanguageContext";

// Settings gear in the header — tucks away the less-used app actions
// (Install app, Update/refresh) that used to crowd the header row.
export function SettingsMenu() {
  const { t } = useLanguage();
  const [installOpen, setInstallOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 sm:h-9 sm:w-9"
            title={t.header.settings}
            aria-label={t.header.settings}
          >
            <Settings className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => refreshApp()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            {t.update.refreshApp}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              // Keep the menu's focus handling from stealing the dialog open.
              e.preventDefault();
              setInstallOpen(true);
            }}
            className="gap-2"
          >
            <Smartphone className="h-4 w-4" />
            {t.install.title}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <InstallDialog open={installOpen} onOpenChange={setInstallOpen} />
    </>
  );
}
