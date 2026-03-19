import React from 'react';
import { Info } from 'lucide-react';

const InfoTooltip = ({ text }) => {
  const [visible, setVisible] = React.useState(false);
  const ref = React.useRef(null);

  // Stäng vid klick utanför
  React.useEffect(() => {
    if (!visible) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setVisible(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [visible]);

  if (!text) return null;

  return (
    <span ref={ref} className="relative inline-flex items-center ml-1">
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        className="text-gray-400 hover:text-gray-600 focus:outline-none"
        aria-label="Visa information om engagemang"
      >
        <Info className="h-4 w-4" />
      </button>
      {visible && (
        <span className="absolute left-6 bottom-0 z-50 w-80 rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg whitespace-pre-line">
          {text}
        </span>
      )}
    </span>
  );
};

export default InfoTooltip;
