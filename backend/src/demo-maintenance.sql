INSERT INTO equipment (code, type_code, hours)
SELECT sample.code, sample.type_code, sample.hours
FROM (VALUES
    ('CAM-103', 'truck', 560),
    ('EXC-206', 'excavator', 285),
    ('PER-305', 'drill', 350)
) AS sample (code, type_code, hours)
WHERE NOT EXISTS (SELECT 1 FROM equipment WHERE equipment.code = sample.code)
ON CONFLICT DO NOTHING;
