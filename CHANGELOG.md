# Changelog

All notable changes to Dify will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Fixed database configuration to allow DB_EXTRAS to set search_path via options (#16a4f77)

### Changed

- Updated dependencies: huggingface-hub (~0.16.4 to ~0.31.0), transformers (~4.35.0 to ~4.39.0), and resend (~0.7.0 to ~2.9.0) (#19563)

## [0.15.7] - 2025-04-27

### Added

- Added support for GPT-4.1 in model providers (#18912)
- Added support for Amazon Bedrock DeepSeek-R1 model (#18908)
- Added support for Amazon Bedrock Claude Sonnet 3.7 model (#18788)
- Refined version compatibility logic in app DSL service

### Fixed

- Fixed issue with creating apps from template categories (#18807, #18868)
- Fixed DSL version check when creating apps from explore templates (#18872, #18878)

## [0.15.6] - 2025-04-22

### Security

- Fixed clickjacking vulnerability (#18552)
- Fixed reset password security issue (#18366)
- Updated reset password token when email code verification succeeds (#18362)

### Fixed

- Fixed Vertex AI Gemini 2.0 Flash 001 schema (#18405)
