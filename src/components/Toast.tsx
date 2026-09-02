"use client";

import * as React from "react";
import { Check, AlertCircle, X as XIcon } from "lucide-react";

export interface ToastProps {
  message: string;
  type: "success" | "error" | "info";
  onClose: () => void;
  duration?: number;
  onCancelRedirect?: () => void;
}

export default function Toast({
  message,
  type,
  onClose,
  duration = 3000,
}: ToastProps) {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const getIcon = () => {
    switch (type) {
      case "success":
        return <Check className="h-5 w-5" />;
      case "error":
        return <AlertCircle className="h-5 w-5" />;
      case "info":
      default:
        return <AlertCircle className="h-5 w-5" />;
    }
  };

  const getColorClasses = () => {
    switch (type) {
      case "success":
        return "bg-green-500 text-white";
      case "error":
        return "bg-red-500 text-white";
      case "info":
      default:
        return "bg-blue-500 text-white";
    }
  };

  return (
    <div
      className={`fixed top-4 right-4 z-50 py-3 px-4 rounded-lg shadow-lg max-w-sm ${getColorClasses()}`}
    >
      <div className="flex items-center space-x-3">
        {getIcon()}
        <span className="flex-1">{message}</span>
        <button
          onClick={onClose}
          className="ml-2 hover:bg-white/20 rounded-full p-1 transition-colors"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
