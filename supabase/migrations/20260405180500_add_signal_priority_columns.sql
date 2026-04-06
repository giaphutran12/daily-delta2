-- Add scoring columns for pipeline signal prioritization
ALTER TABLE public.signals
ADD COLUMN IF NOT EXISTS priority_score integer;

ALTER TABLE public.signals
ADD COLUMN IF NOT EXISTS priority_tier text
CHECK (priority_tier IN ('high', 'medium', 'low'));
