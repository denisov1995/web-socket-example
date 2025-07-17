pipeline {
  agent any
  environment {
    DOCKER_HUB_PASSWORD = credentials('dockerhub') // если настроено как Jenkins secret
  }
  stages {
    stage('Checkout') {
      steps {
        git 'https://github.com/denisov1995/web-socket-example'
      }
    }
    stage('Login to Docker Hub') {
      steps {
        sh 'echo $DOCKER_HUB_PASSWORD | docker login -u nero010 --password-stdin'
      }
    }
    stage('Build Docker Image') {
      steps {
        sh 'docker build -t nero010/chat-app .'
      }
    }
    stage('Push to Hub') {
      steps {
        sh 'docker push nero010/chat-app'
      }
    }
  }
}
