import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Smartphone, Download, CheckCircle, Share, Chrome, Globe } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isSamsungInternet, setIsSamsungInternet] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
      return;
    }

    // Check if iOS
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(isIOSDevice);

    // Check if Samsung Internet Browser
    const isSamsung = /SamsungBrowser/.test(navigator.userAgent);
    setIsSamsungInternet(isSamsung);

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

  if (isInstalled) {
    return (
      <Button variant="ghost" size="sm" className="gap-1.5 h-8 sm:h-9 px-2 sm:px-3 text-success" disabled>
        <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span className="hidden sm:inline text-xs">{t.install.appInstalled}</span>
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 sm:h-9 px-2 sm:px-3">
          <Smartphone className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">{t.install.title}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 sm:w-96" align="end">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-primary" />
            <h4 className="font-semibold">{t.install.title}</h4>
          </div>
          
          <p className="text-sm text-muted-foreground">
            {t.install.installOnDevice}
          </p>

          {deferredPrompt && (
            <Button onClick={handleInstall} className="w-full gap-2">
              <Download className="h-4 w-4" />
              {t.install.installNow}
            </Button>
          )}

          <div className="space-y-4 pt-2">
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
