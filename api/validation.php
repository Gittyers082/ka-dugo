<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

function sanitizeString(mixed $value): string {
    if ($value === null) {
        return '';
    }
    return trim(strip_tags((string)$value));
}

function requireFields(array $input, array $requiredFields): void {
    $missing = [];
    foreach ($requiredFields as $field) {
        if (!isset($input[$field]) || trim((string)$input[$field]) === '') {
            $missing[] = $field;
        }
    }

    if (!empty($missing)) {
        sendJson(false, 'Missing required fields: ' . implode(', ', $missing), [
            'missing_fields' => $missing
        ], 422);
    }
}

function validateBloodType(string $bloodType): string {
    $normalized = strtoupper(trim($bloodType));
    $validTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

    if (!in_array($normalized, $validTypes, true)) {
        sendJson(false, "Invalid blood type '{$bloodType}'. Allowed: " . implode(', ', $validTypes), null, 422);
    }

    return $normalized;
}

function validateEnum(string $value, array $allowedValues, string $fieldName): string {
    $trimmed = trim($value);
    if (!in_array($trimmed, $allowedValues, true)) {
        sendJson(false, "Invalid {$fieldName} '{$value}'. Allowed: " . implode(', ', $allowedValues), null, 422);
    }
    return $trimmed;
}

function validateIntRange(mixed $value, int $min, int $max, string $fieldName): int {
    if (!is_numeric($value) || (int)$value != $value) {
        sendJson(false, "{$fieldName} must be a whole number.", null, 422);
    }

    $intVal = (int)$value;
    if ($intVal < $min || $intVal > $max) {
        sendJson(false, "{$fieldName} must be between {$min} and {$max}.", null, 422);
    }

    return $intVal;
}

function validateFloatRange(mixed $value, float $min, float $max, string $fieldName): float {
    if (!is_numeric($value)) {
        sendJson(false, "{$fieldName} must be a valid number.", null, 422);
    }

    $floatVal = (float)$value;
    if ($floatVal < $min || $floatVal > $max) {
        sendJson(false, "{$fieldName} must be between {$min} and {$max}.", null, 422);
    }

    return $floatVal;
}

function validateDateString(string $dateStr, string $fieldName): string {
    $trimmed = trim($dateStr);
    $dt = DateTime::createFromFormat('Y-m-d', $trimmed);
    if (!$dt || $dt->format('Y-m-d') !== $trimmed) {
        sendJson(false, "{$fieldName} must be a valid date in YYYY-MM-DD format.", null, 422);
    }
    return $trimmed;
}

function validateBloodPressure(string $bp): string {
    $trimmed = trim($bp);
    if (!preg_match('/^(\d{2,3})\/(\d{2,3})$/', $trimmed, $matches)) {
        sendJson(false, "Blood pressure must be in 'Systolic/Diastolic' format (e.g., 120/80).", null, 422);
    }

    $systolic  = (int)$matches[1];
    $diastolic = (int)$matches[2];

    if ($systolic < 70 || $systolic > 220 || $diastolic < 40 || $diastolic > 140 || $systolic <= $diastolic) {
        sendJson(false, "Blood pressure reading ({$trimmed}) is outside valid physiological ranges.", null, 422);
    }

    return $trimmed;
}
