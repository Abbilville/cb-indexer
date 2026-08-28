package gitwatcher

import (
	"bytes"
	"context"
	"os/exec"
	"strings"
	"time"
)

// GetRepoCommitHash returns the current HEAD commit hash of a git repository.
func GetRepoCommitHash(ctx context.Context, repoPath string) (string, error) {
	execCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "git", "rev-parse", "HEAD")
	cmd.Dir = repoPath
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf

	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimSpace(outBuf.String()), nil
}

// GitFetch runs git fetch origin with a timeout.
func GitFetch(ctx context.Context, repoPath string) error {
	execCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "git", "fetch", "origin")
	cmd.Dir = repoPath
	return cmd.Run()
}

// GitPull attempts git pull origin on the active branch, returning whether new commits were pulled.
func GitPull(ctx context.Context, repoPath string) (bool, error) {
	beforeHash, _ := GetRepoCommitHash(ctx, repoPath)

	execCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "git", "pull")
	cmd.Dir = repoPath
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf

	if err := cmd.Run(); err != nil {
		return false, err
	}

	afterHash, _ := GetRepoCommitHash(ctx, repoPath)
	return beforeHash != "" && afterHash != "" && beforeHash != afterHash, nil
}
