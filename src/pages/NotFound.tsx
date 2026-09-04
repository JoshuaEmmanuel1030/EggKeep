import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1
          className="mb-4 text-8xl font-bold animate-bounce"
          style={{ animationDuration: "1.5s" }}
        >
          404
        </h1>
        <p
          className="mb-6 text-xl text-muted-foreground opacity-0"
          style={{ animation: "fadeIn 0.6s ease-out 0.4s forwards" }}
        >
          Oops! Page not found
        </p>
        <a
          href="/"
          className="text-primary underline hover:text-primary/90 opacity-0"
          style={{ animation: "fadeIn 0.6s ease-out 0.8s forwards" }}
        >
          Return to Home
        </a>
      </div>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default NotFound;
