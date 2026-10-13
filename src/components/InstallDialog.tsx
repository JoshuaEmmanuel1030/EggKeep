import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Smartphone, Download, CheckCircle, Share, Chrome, Globe } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Install-to-home-screen instructions, now tucked inside the Settings menu
// (was a standalone header button). Controlled dialog so the menu item opens it.
export function InstallDialog({ open, onOpenChange }: InstallDialogProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
      return;
    }

    // Listen for install prompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            {t.install.title}
          </DialogTitle>
          <DialogDescription>{t.install.installOnDevice}</DialogDescription>
        </DialogHeader>

        {isInstalled ? (
          <div className="flex items-center gap-2 text-success py-4">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm font-medium">{t.install.appInstalled}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {deferredPrompt && (
              <Button onClick={handleInstall} className="w-full gap-2">
                <Download className="h-4 w-4" />
                {t.install.installNow}
              </Button>
            )}

            {/* Android Chrome Instructions */}
            <div className="space-y-2 p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2">
                <Chrome className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">{t.install.androidChrome}</p>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1.5 ml-6">
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">1.</span>
                  <span>{t.install.androidStep1}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">2.</span>
                  <span>{t.install.androidStep2}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">3.</span>
                  <span>{t.install.androidStep3}</span>
                </li>
              </ol>
            </div>

            {/* Samsung Internet Instructions */}
            <div className="space-y-2 p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">{t.install.samsungInternet}</p>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1.5 ml-6">
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">1.</span>
                  <span>{t.install.samsungStep1}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">2.</span>
                  <span>{t.install.samsungStep2}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">3.</span>
                  <span>{t.install.samsungStep3}</span>
                </li>
              </ol>
            </div>

            {/* iOS Safari Instructions */}
            <div className="space-y-2 p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-2">
                <Share className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">{t.install.iosSafari}</p>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1.5 ml-6">
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">1.</span>
                  <span>{t.install.iosStep1}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">2.</span>
                  <span>{t.install.iosStep2}</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">3.</span>
                  <span>{t.install.iosStep3}</span>
                </li>
              </ol>
            </div>

            <p className="text-xs text-center text-muted-foreground pt-1">
              ✨ {t.install.findOnHomeScreen}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
