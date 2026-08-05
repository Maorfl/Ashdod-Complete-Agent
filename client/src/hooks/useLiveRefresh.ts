/**
 * useLiveRefresh — רענון "חי" של דף שמבוסס על סבב ה-commit האמיתי בשרת, לא על שעון עיוור.
 * בודק את watcherStatus().last.at בקצב זול; כשהוא משתנה (סבב הסתיים) מפעיל onCycle().
 * טיימר גיבוי מריץ onCycle גם אם בדיקת הסטטוס נכשלת שוב ושוב — כדי שהדף תמיד יתאושש.
 * לא תלוי בזהות פונקציה חיצונית: הטיימרים נוצרים פעם אחת ב-mount וקוראים callbacks עדכניים דרך ref,
 * כדי שרינדורים חוזרים לא יאתחלו את המרווח מחדש.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

const CHECK_INTERVAL_MS = 15000; // תדירות בדיקת watcherStatus — זולה, לא מרעננת דאטה בעצמה
const FALLBACK_INTERVAL_MS = 60000; // רשת גיבוי אם בדיקת הסטטוס נכשלת שוב ושוב

export interface LiveRefreshInfo {
  lastCycleAt: string | null; // "at" של סבב ה-commit האחרון בשרת (services/reportWatcher.js: lastRun.at)
  lastCheckOk: boolean; // false אם בדיקת watcherStatus האחרונה נכשלה (לא אותו דבר כמו רענון דאטה)
  failing: boolean; // כשל חוזר — 3+ בדיקות רצופות נכשלו
}

export function useLiveRefresh(onCycle: () => void): LiveRefreshInfo {
  const onCycleRef = useRef(onCycle);
  onCycleRef.current = onCycle;

  const [info, setInfo] = useState<LiveRefreshInfo>({ lastCycleAt: null, lastCheckOk: true, failing: false });
  const lastSeenAtRef = useRef<string | null>(null);
  const failCountRef = useRef(0);

  useEffect(() => {
    let stopped = false;

    async function checkCycle() {
      try {
        const w = await api.watcherStatus();
        const at = (w.last && (w.last as any).at) || null;
        failCountRef.current = 0;
        if (stopped) return;
        setInfo({ lastCycleAt: at, lastCheckOk: true, failing: false });
        if (at && at !== lastSeenAtRef.current) {
          const first = lastSeenAtRef.current === null;
          lastSeenAtRef.current = at;
          if (!first) onCycleRef.current(); // דילוג על ה-trigger הראשון — הטעינה הראשונית כבר קורית בנפרד
        }
      } catch {
        if (stopped) return;
        failCountRef.current += 1;
        setInfo((prev) => ({ ...prev, lastCheckOk: false, failing: failCountRef.current >= 3 }));
      }
    }

    checkCycle();
    const checkTimer = window.setInterval(checkCycle, CHECK_INTERVAL_MS);
    const fallbackTimer = window.setInterval(() => onCycleRef.current(), FALLBACK_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(checkTimer);
      window.clearInterval(fallbackTimer);
    };
  }, []);

  return info;
}
