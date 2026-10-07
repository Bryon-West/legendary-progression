import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Modal } from '@/components/modal';
import { EDUCATION_CONTENT, type EducationKey } from '@/lib/education-content';

type TrainingMode = 'basic' | 'legendary_pro';

export function EducationInfo({
  term,
  children,
  currentMode,
  testId,
  className,
}: {
  term: EducationKey;
  children?: ReactNode;
  currentMode?: TrainingMode;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const content = EDUCATION_CONTENT[term];
  const modeAccent = content.accent === 'basic' ? 'basic' : content.accent === 'pro' ? 'pro' : undefined;
  const trigger = children
    ? <>{children}<Info className="education-trigger__icon" size={13} aria-hidden="true" /></>
    : <Info size={14} aria-hidden="true" />;
  const triggerLabel = children ? `Learn about ${content.title}` : `More about ${content.title}`;

  return <>
    <button
      type="button"
      className={`education-trigger ${className ?? ''}`}
      onClick={() => setOpen(true)}
      aria-label={triggerLabel}
      data-testid={testId ?? `info-${term.replaceAll('_', '-')}`}
    >
      {trigger}
    </button>
    {open && <Modal title={content.title} close={() => setOpen(false)}>
      <article className={`education-copy${modeAccent ? ` education-copy--${modeAccent}` : ''}`} data-testid={`education-content-${term.replaceAll('_', '-')}`}>
        {content.subtitle && <div className="education-subtitle">{content.subtitle}</div>}
        {content.beta && <span className="education-beta">FREE DURING BETA</span>}
        {currentMode && <span className="education-current">CURRENT MODE</span>}
        <p className="education-definition">{content.definition}</p>
        {content.example && <div className="education-example"><span className="eyebrow">Example</span><p>{content.example}</p></div>}
        {content.takeaway && <p className="education-takeaway">{content.takeaway}</p>}
      </article>
    </Modal>}
  </>;
}
