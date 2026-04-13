import { useState, useCallback, useEffect } from 'react';
import { TUTORIAL_STEPS } from './tutorialSteps';

const LS_KEY = 'stirrup-tutorial-completed';

export function useTutorial() {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  // Auto-start on first visit (after a short delay so the app renders first)
  useEffect(() => {
    if (!localStorage.getItem(LS_KEY)) {
      const timer = setTimeout(() => setIsActive(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const findNextVisible = useCallback((from: number, direction: 1 | -1): number => {
    let idx = from;
    while (idx >= 0 && idx < TUTORIAL_STEPS.length) {
      const step = TUTORIAL_STEPS[idx];
      if (!step.target || !step.optional) return idx;
      // Check if the target element exists in the DOM
      if (document.querySelector(step.target)) return idx;
      idx += direction;
    }
    return Math.max(0, Math.min(idx, TUTORIAL_STEPS.length - 1));
  }, []);

  const startTutorial = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const nextStep = useCallback(() => {
    const next = findNextVisible(currentStep + 1, 1);
    if (next >= TUTORIAL_STEPS.length - 1) {
      // Last step — mark as done after user clicks Finish
    }
    setCurrentStep(next);
  }, [currentStep, findNextVisible]);

  const prevStep = useCallback(() => {
    const prev = findNextVisible(currentStep - 1, -1);
    setCurrentStep(prev);
  }, [currentStep, findNextVisible]);

  const endTutorial = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(LS_KEY, 'true');
  }, []);

  return {
    isActive,
    currentStep,
    totalSteps: TUTORIAL_STEPS.length,
    step: TUTORIAL_STEPS[currentStep],
    isFirst: currentStep === 0,
    isLast: currentStep === TUTORIAL_STEPS.length - 1,
    startTutorial,
    nextStep,
    prevStep,
    endTutorial,
  };
}
