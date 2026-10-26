package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"

	"github.com/hauxyz/sendme/server/internal/api"
	"github.com/hauxyz/sendme/server/internal/auth"
	"github.com/hauxyz/sendme/server/internal/config"
	"github.com/hauxyz/sendme/server/internal/crypto"
	"github.com/hauxyz/sendme/server/internal/database"
	"github.com/hauxyz/sendme/server/internal/mailer"
	"github.com/hauxyz/sendme/server/internal/queue"
	"github.com/hauxyz/sendme/server/internal/tracking"
	"github.com/hauxyz/sendme/server/internal/worker"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("load configuration", "error", err)
		os.Exit(1)
	}

	logLevel := slog.LevelInfo
	if cfg.Env == "development" {
		logLevel = slog.LevelDebug
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("connect to postgres", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db); err != nil {
		logger.Error("run migrations", "error", err)
		os.Exit(1)
	}

	q, redisOpt, err := queue.New(cfg.RedisURL)
	if err != nil {
		logger.Error("connect to redis", "error", err)
		os.Exit(1)
	}
	defer q.Close()

	for attempt := 0; attempt < 30; attempt++ {
		pingCtx, pingCancel := context.WithTimeout(context.Background(), 2*time.Second)
		err = q.Redis().Ping(pingCtx).Err()
		pingCancel()
		if err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		logger.Error("redis is unavailable", "error", err)
		os.Exit(1)
	}

	sealer, err := crypto.NewSealer(cfg.EncryptionKey)
	if err != nil {
		logger.Error("initialize encryption", "error", err)
		os.Exit(1)
	}
	tokens := auth.NewTokens([]byte(cfg.JWTSecret), cfg.SessionTTL, cfg.CookieSecure, cfg.CookieDomain)
	mailerSvc := mailer.New()
	tracker := tracking.New(cfg.SigningSecret, cfg.APIBaseURL)

	apiServer := api.New(cfg, db, q, tokens, sealer, mailerSvc, tracker, logger)
	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           apiServer.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("SendMe API listening", "addr", httpServer.Addr, "env", cfg.Env)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErrors <- err
		}
	}()

	var taskServer *asynq.Server
	if cfg.WorkerEnabled {
		taskServer = asynq.NewServer(redisOpt, asynq.Config{
			Concurrency: cfg.WorkerConcurrency,
			Queues: map[string]int{
				"emails":    10,
				"campaigns": 3,
				"webhooks":  5,
			},
			ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
				logger.Warn("background task failed", "type", task.Type(), "error", err)
			}),
		})
		w := worker.New(cfg, db, q, mailerSvc, sealer, tracker, logger)
		if err := taskServer.Start(w.Mux()); err != nil {
			logger.Error("start worker", "error", err)
			os.Exit(1)
		}
		logger.Info("background worker started", "concurrency", cfg.WorkerConcurrency)
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErrors:
		logger.Error("http server failed", "error", err)
	case sig := <-stop:
		logger.Info("shutting down", "signal", sig.String())
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if taskServer != nil {
		taskServer.Shutdown()
	}
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown http server", "error", err)
	}
	logger.Info("goodbye")
}
