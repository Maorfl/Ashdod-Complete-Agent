/**
 * AgentFilterContext — מסנן גלובלי לפי עמיל מכס (מחלקה).
 * הבחירה נשמרת ב-localStorage ושורדת ניווט ורענון. הסינון בפועל לפי department
 * (cus1/cus2/cus3), עם fallback לנרמול שם הסוכן כשה-department חסר.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type AgentKey = 'all' | 'cus1' | 'cus2' | 'cus3';

export const AGENTS: { key: AgentKey; name: string; code: string }[] = [
  { key: 'all', name: 'הכל', code: '' },
  { key: 'cus1', name: 'משה רוסו', code: 'CUS1' },
  { key: 'cus2', name: 'דורון רימה', code: 'CUS2' },
  { key: 'cus3', name: 'אביהוא עבדי', code: 'CUS3' },
];

// נרמול וריאנטים של שמות מהדוח ומה-DB לצורה קנונית אחת (מחלקה)
const NAME_TO_DEPT: Record<string, Exclude<AgentKey, 'all'>> = {
  'משה רוסו': 'cus1',
  'דורון רימה': 'cus2',
  'דורון רימא': 'cus2',
  'אביהוא עבדי': 'cus3',
  'אביהו עבדי': 'cus3',
  'אביהוא עבאדי': 'cus3',
  'אביהו עבאדי': 'cus3',
};

function normName(s?: string | null): string {
  return String(s || '').replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim();
}

/** ממפה שם סוכן (בכל וריאנט) למחלקה קנונית, או null אם לא מזוהה */
export function agentNameToDept(name?: string | null): Exclude<AgentKey, 'all'> | null {
  return NAME_TO_DEPT[normName(name)] || null;
}

/** בדיקת התאמה: department קודם, ואם חסר — נרמול שם הסוכן/נציג */
export function matchesAgent(
  rec: { department?: string | null; agent_name?: string | null; service_rep?: string | null },
  agent: AgentKey
): boolean {
  if (agent === 'all') return true;
  const dept = String(rec.department || '').toLowerCase().trim();
  if (dept) return dept === agent;
  return agentNameToDept(rec.agent_name) === agent || agentNameToDept(rec.service_rep) === agent;
}

const STORAGE_KEY = 'caspi.agent_filter';

const Ctx = createContext<{ agent: AgentKey; setAgent: (a: AgentKey) => void }>({
  agent: 'all',
  setAgent: () => {},
});

export function AgentFilterProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<AgentKey>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'cus1' || saved === 'cus2' || saved === 'cus3' ? saved : 'all';
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, agent);
  }, [agent]);

  return <Ctx.Provider value={{ agent, setAgent }}>{children}</Ctx.Provider>;
}

export function useAgentFilter() {
  return useContext(Ctx);
}
