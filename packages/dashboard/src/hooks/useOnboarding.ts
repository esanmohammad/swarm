import { useState, useCallback } from 'react';

const STORAGE_KEY = 'swarm_onboarded';
const STEP_KEY = 'swarm_onboarding_step';

export type OnboardingStep =
  | 'welcome'
  | 'first-launch'
  | 'analyzing'
  | 'stage-complete'
  | 'building'
  | 'done'
  | null;

export function useOnboarding() {
  const [isFirstVisit] = useState(() => {
    try {
      return !localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
  });

  const [currentStep, setCurrentStep] = useState<OnboardingStep>(() => {
    if (!isFirstVisit) return null;
    try {
      return (localStorage.getItem(STEP_KEY) as OnboardingStep) || 'welcome';
    } catch {
      return 'welcome';
    }
  });

  const advanceStep = useCallback((step: OnboardingStep) => {
    setCurrentStep(step);
    try {
      if (step) {
        localStorage.setItem(STEP_KEY, step);
      } else {
        localStorage.removeItem(STEP_KEY);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  const dismissStep = useCallback(() => {
    setCurrentStep(null);
    try {
      localStorage.removeItem(STEP_KEY);
    } catch {
      // localStorage not available
    }
  }, []);

  const completeOnboarding = useCallback(() => {
    setCurrentStep(null);
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
      localStorage.removeItem(STEP_KEY);
    } catch {
      // localStorage not available
    }
  }, []);

  const resetOnboarding = useCallback(() => {
    setCurrentStep('welcome');
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STEP_KEY, 'welcome');
    } catch {
      // localStorage not available
    }
  }, []);

  return {
    isFirstVisit,
    currentStep,
    advanceStep,
    dismissStep,
    completeOnboarding,
    resetOnboarding,
  };
}
