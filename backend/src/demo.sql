INSERT INTO equipment (code, type_code, hours) VALUES
    ('CAM-101', 'truck', 1250),
    ('EXC-204', 'excavator', 875),
    ('PER-303', 'drill', 570),
    ('CAM-102', 'truck', 740),
    ('EXC-205', 'excavator', 1220),
    ('PER-304', 'drill', 1050)
ON CONFLICT DO NOTHING;

INSERT INTO maintenance (equipment_id, hours, notes, performed_at)
SELECT equipment.id, sample.hours, sample.notes, now() - sample.ago
FROM (VALUES
    ('CAM-101', 750, 'Inspección de frenos y cambio de filtros.', interval '18 days'),
    ('EXC-204', 680, 'Revisión del sistema hidráulico.', interval '12 days'),
    ('PER-303', 300, 'Inspección de cabezal y lubricación.', interval '20 days'),
    ('CAM-102', 500, 'Mantenimiento preventivo programado.', interval '15 days'),
    ('EXC-205', 1000, 'Revisión de orugas y puntos de engrase.', interval '10 days'),
    ('PER-304', 900, 'Cambio de consumibles y calibración.', interval '9 days')
) AS sample (code, hours, notes, ago)
JOIN equipment ON equipment.code = sample.code
WHERE equipment.deleted_at IS NULL
  AND equipment.hours >= sample.hours
  AND NOT EXISTS (SELECT 1 FROM maintenance WHERE equipment_id = equipment.id);
