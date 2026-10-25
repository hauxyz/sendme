package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

const (
	TaskEmailSend      = "email:send"
	TaskCampaignSend   = "campaign:send"
	TaskWebhookDeliver = "webhook:deliver"
)

type Client struct {
	asynq *asynq.Client
	redis *redis.Client
}

type EmailSendPayload struct {
	EmailID string `json:"email_id"`
}

type CampaignSendPayload struct {
	CampaignID string `json:"campaign_id"`
}

type WebhookDeliveryPayload struct {
	DeliveryID string `json:"delivery_id"`
}

func New(redisURL string) (*Client, asynq.RedisConnOpt, error) {
	redisOpt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, nil, fmt.Errorf("parse redis url: %w", err)
	}
	rdb, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, nil, fmt.Errorf("parse redis url: %w", err)
	}
	return &Client{
		asynq: asynq.NewClient(redisOpt),
		redis: redis.NewClient(rdb),
	}, redisOpt, nil
}

func (c *Client) Close() error {
	_ = c.redis.Close()
	return c.asynq.Close()
}

func (c *Client) Redis() *redis.Client {
	return c.redis
}

func (c *Client) EnqueueEmail(emailID string, at time.Time) error {
	payload, _ := json.Marshal(EmailSendPayload{EmailID: emailID})
	task := asynq.NewTask(TaskEmailSend, payload)
	opts := []asynq.Option{
		asynq.MaxRetry(3),
		asynq.Timeout(90 * time.Second),
		asynq.Queue("emails"),
	}
	if !at.IsZero() && at.After(time.Now()) {
		opts = append(opts, asynq.ProcessAt(at))
	}
	_, err := c.asynq.Enqueue(task, opts...)
	return err
}

func (c *Client) EnqueueCampaign(campaignID string, at time.Time) error {
	payload, _ := json.Marshal(CampaignSendPayload{CampaignID: campaignID})
	task := asynq.NewTask(TaskCampaignSend, payload)
	opts := []asynq.Option{
		asynq.MaxRetry(3),
		asynq.Timeout(30 * time.Minute),
		asynq.Queue("campaigns"),
	}
	if !at.IsZero() {
		opts = append(opts, asynq.ProcessAt(at))
	}
	_, err := c.asynq.Enqueue(task, opts...)
	return err
}

func (c *Client) EnqueueWebhook(deliveryID string) error {
	payload, _ := json.Marshal(WebhookDeliveryPayload{DeliveryID: deliveryID})
	task := asynq.NewTask(TaskWebhookDeliver, payload)
	_, err := c.asynq.Enqueue(task,
		asynq.MaxRetry(5),
		asynq.Timeout(20*time.Second),
		asynq.Queue("webhooks"),
	)
	return err
}

func (c *Client) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, int, error) {
	pipe := c.redis.Pipeline()
	countCmd := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, 0, err
	}
	count := int(countCmd.Val())
	return count <= limit, max(0, limit-count), nil
}
