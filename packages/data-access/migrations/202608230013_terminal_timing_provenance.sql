DO $$
DECLARE
  provenance_constraint text;
BEGIN
  SELECT constraint_row.conname
  INTO provenance_constraint
  FROM pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'purchase_timing_assessments'::regclass
    AND constraint_row.contype = 'c'
    AND pg_get_constraintdef(constraint_row.oid) LIKE '%plan_version_id IS NULL%'
    AND pg_get_constraintdef(constraint_row.oid) LIKE '%plan_lifecycle%'
    AND pg_get_constraintdef(constraint_row.oid) LIKE '%plan_health IS NULL%';

  IF provenance_constraint IS NULL THEN
    RAISE EXCEPTION 'purchase timing plan provenance constraint was not found';
  END IF;

  EXECUTE format(
    'ALTER TABLE purchase_timing_assessments DROP CONSTRAINT %I',
    provenance_constraint
  );
END
$$;

ALTER TABLE purchase_timing_assessments
  ADD CONSTRAINT purchase_timing_assessments_plan_provenance_check
  CHECK (
    (
      plan_lifecycle = 'draft'
      AND plan_version_id IS NULL
      AND plan_version_number IS NULL
      AND plan_health IS NULL
    ) OR (
      plan_lifecycle = 'active'
      AND plan_version_id IS NOT NULL
      AND plan_version_number IS NOT NULL
      AND plan_health IS NOT NULL
    ) OR (
      plan_lifecycle IN ('completed', 'archived')
      AND plan_version_id IS NOT NULL
      AND plan_version_number IS NOT NULL
      AND plan_health IS NULL
    )
  );
