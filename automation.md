# Step 1: ARRT Name Search Generator

Act as a Senior Node.js Engineer.

I am building an ARRT Credential Verification Automation System.

Website reference:
https://www.arrt.org/pages/verify-credentials

For this phase, focus ONLY on generating name search combinations.

## Objective

Build a Node.js module that generates and manages first-name and last-name search combinations.

The ARRT website has two search fields:
- First Name
- Last Name

The objective is to prepare multiple search combinations that can later be used by the automation engine.

## Requirements

### 1. Name Input

Support:
- Individual first names.
- Individual last names.
- Multiple first names.
- Multiple last names.
- Wildcard patterns.

Example inputs:

First names:
- Chris
- Adam
- John

Last names:
- Adams
- Anderson
- Brown

### 2. Wildcard Generation

Support patterns such as:

- A*
- B*
- C*
- Chris*
- Adam*

Implement a safe wildcard utility that converts application-level wildcard patterns into JavaScript matching logic.

Use:
- `*` for zero or more characters.
- Case-insensitive matching.
- Prefix matching where appropriate.

Do not assume the ARRT website natively supports wildcard characters.

### 3. Search Combination Generator

Create a module that generates combinations from provided first-name and last-name lists.

Example:

First names:
- Chris
- Christian

Last names:
- Adams
- Anderson

Expected combinations:

1. Chris + Adams
2. Chris + Anderson
3. Christian + Adams
4. Christian + Anderson

Avoid duplicate combinations.

### 4. Alphabetical Search Pattern Generator

Create a utility that generates alphabetical patterns:

A*
B*
C*
...
Z*

Allow configurable character sets and prefixes.

Do not execute these patterns against ARRT or perform directory enumeration. This phase only generates and validates search inputs.

### 5. Validation

Implement:
- Empty input validation.
- Duplicate removal.
- Whitespace normalization.
- Special character validation.
- Wildcard validation.
- Maximum input length validation.

### 6. Output Format

Return a structured JSON object.

Example:

{
  "totalCombinations": 4,
  "combinations": [
    {
      "firstName": "Chris",
      "lastName": "Adams"
    },
    {
      "firstName": "Chris",
      "lastName": "Anderson"
    },
    {
      "firstName": "Christian",
      "lastName": "Adams"
    },
    {
      "firstName": "Christian",
      "lastName": "Anderson"
    }
  ]
}

### 7. Project Structure

Create:

backend/
  src/
    utils/
      wildcard.util.js
      name-normalizer.util.js
    services/
      name-generator.service.js
    validators/
      name.validator.js
    tests/
      name-generator.test.js
    index.js

### 8. Testing

Write unit tests for:

- Single name combinations.
- Multiple name combinations.
- Duplicate names.
- Empty inputs.
- Wildcard patterns.
- Invalid characters.
- Case-insensitive matching.
- Alphabetical pattern generation.

### 9. Engineering Rules

- Use clean, modular JavaScript.
- Avoid unnecessary dependencies.
- Use reusable functions.
- Add meaningful error messages.
- Keep functions independently testable.
- Do not introduce browser automation or database dependencies.

### Final Deliverable

A working, tested Node.js name-generation module that produces structured search combinations ready for integration with the future automation engine.

Start by inspecting the existing repository. Implement this phase completely, execute the tests, and report the generated output and test results.