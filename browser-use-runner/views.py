from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RunStatus(str, Enum):
	passed = 'passed'
	failed = 'failed'
	blocked = 'blocked'
	stopped = 'stopped'


class LLMConfig(BaseModel):
	model_config = ConfigDict(extra='forbid')

	model: str = Field(default='deepseek-chat')
	max_tokens: int | None = Field(default=None, ge=1, description='Max completion tokens; use to fit models with small context windows')


class BrowserProfileConfig(BaseModel):
	model_config = ConfigDict(extra='forbid')

	is_mobile: bool = Field(default=False, description='Use mobile viewport + UA (iPhone 14 preset)')
	viewport_width: int | None = Field(default=None, ge=320, le=7680)
	viewport_height: int | None = Field(default=None, ge=200, le=4320)
	device_scale_factor: float | None = Field(default=None, ge=0.5, le=5.0, description='DPR, e.g. 2.0 for retina')
	user_agent: str | None = Field(default=None, description='Custom User-Agent string')
	locale: str | None = Field(default=None, description='Browser locale, e.g. ru-RU, en-US')
	timezone_id: str | None = Field(default=None, description='IANA timezone, e.g. Europe/Moscow, UTC')


class RunRequest(BaseModel):
	model_config = ConfigDict(extra='forbid')

	test_case_id: str | None = None
	language: Literal['ru', 'en'] = 'ru'
	task: str = Field(min_length=1, description='Full browser-use task prompt')
	start_url: str | None = Field(default=None, description='Open this URL before starting the task')
	preflight_url: bool = Field(default=True, description='Check start_url availability before browser-use starts')
	preflight_timeout_sec: float = Field(default=45, ge=1, le=120)
	preflight_retries: int = Field(default=3, ge=0, le=10)
	preflight_verify_ssl: bool = Field(default=False, description='Verify TLS certificate during preflight request')
	navigation_timeout_sec: float = Field(default=75, ge=5, le=300)
	navigation_wait_until: Literal['load', 'domcontentloaded', 'networkidle', 'commit'] = 'domcontentloaded'
	action_timeout_sec: float = Field(default=180, ge=30, le=600)
	llm_timeout_sec: int = Field(default=90, ge=30, le=600)
	system_instructions: str | None = Field(default=None, description='Extra system instructions for the browser-use agent')
	max_steps: int = Field(default=30, ge=1, le=500)
	use_vision: bool = False
	headless: bool = True
	llm: LLMConfig = Field(default_factory=LLMConfig)
	sensitive_data: dict[str, str] | None = Field(
		default=None,
		description='Placeholder → real value. Use {placeholder} in task. Values are redacted from logs/screenshots by browser-use.',
	)
	browser_profile: BrowserProfileConfig = Field(default_factory=BrowserProfileConfig)


class TokenUsageReport(BaseModel):
	model_config = ConfigDict(extra='forbid')

	prompt_tokens: int = 0
	prompt_cached_tokens: int | None = None
	prompt_cache_creation_tokens: int | None = None
	prompt_image_tokens: int | None = None
	completion_tokens: int = 0
	total_tokens: int = 0
	estimated: bool = False


class LLMCallUsageReport(TokenUsageReport):
	llm_call_index: int
	model: str | None = None


class SessionUsageReport(TokenUsageReport):
	llm_call_count: int = 0
	models: dict[str, TokenUsageReport] = Field(default_factory=dict)


class ArtifactReport(BaseModel):
	model_config = ConfigDict(extra='forbid')

	visited_urls: list[str] = Field(default_factory=list)
	screenshot_paths: list[str] = Field(default_factory=list)


class RunResponse(BaseModel):
	model_config = ConfigDict(extra='forbid')

	test_case_id: str | None = None
	status: RunStatus
	summary: str
	steps_count: int = 0
	instability_step_count: int = 0
	retry_step_count: int = 0
	errors: list[str] = Field(default_factory=list)
	artifacts: ArtifactReport
	duration_sec: float
	run_id: str | None = None
	run_dir: str | None = None
	usage: SessionUsageReport | None = None
	llm_usage: list[LLMCallUsageReport] = Field(default_factory=list)
