pipeline {
  agent any
  environment {
    DOCKER_HUB_TOKEN = credentials('dockerhub-token') // если используешь Jenkins secret
  }
  stages {
    stage('Docker Login') {
      steps {
        sh 'echo $DOCKER_HUB_TOKEN | docker login -u nero010 --password-stdin'
      }
    }
    stage('Build Docker Image') {
      steps {
        sh 'docker build --no-cache -t nero010/chat-app .'
      }
    }
    stage('Push to Hub') {
      steps {
        sh 'docker push nero010/chat-app'
      }
    }
  }
}
