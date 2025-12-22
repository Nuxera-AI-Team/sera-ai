import React, { useState, useEffect, useCallback } from 'react';
import { AudioRecorderProps, APIResponse, APIOptions } from './types';

const DEFAULT_BASE_URL = 'https://api.yourbackend.com';

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  apiKey,
  onSuccess,
  onError,
  baseUrl = DEFAULT_BASE_URL,
  className = '',
  style,
  ...props
}) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) {
      console.error('AudioRecorder: apiKey prop is required');
    }
  }, [apiKey]);

  const callAPI = useCallback(
    async <T = any,>(
      endpoint: string,
      options: APIOptions = {}
    ): Promise<APIResponse<T> | null> => {
      if (!apiKey) {
        const errorMsg = 'API key is required';
        setError(errorMsg);
        onError?.(errorMsg);
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${baseUrl}/${endpoint}`, {
          method: options.method || 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...options.headers,
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const result: APIResponse<T> = await response.json();
        
        if (result.success) {
          setData(result.data);
          onSuccess?.(result.data);
        } else {
          throw new Error(result.error || 'Unknown error occurred');
        }
        
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        onError?.(errorMessage);
        console.error('API Error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiKey, baseUrl, onSuccess, onError]
  );

  const handleAction = async () => {
    await callAPI('your-endpoint', { method: 'POST' });
  };

  return (
    <div 
      className={`your-component ${className}`} 
      style={style}
      {...props}
    >
      <h2>Your Service Component</h2>
      
      {loading && (
        <div className="loading">
          Loading...
        </div>
      )}
      
      {error && (
        <div className="error" style={{ color: 'red' }}>
          Error: {error}
        </div>
      )}
      
      {data && (
        <div className="data">
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </div>
      )}
      
      <button 
        onClick={handleAction} 
        disabled={loading || !apiKey}
        type="button"
      >
        Call API
      </button>
    </div>
  );
};

export default AudioRecorder;